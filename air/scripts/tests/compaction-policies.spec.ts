import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  FULL_REPLY_MARGIN,
  MODEL_WINDOWS,
  RESERVED_OUTPUT_TOKENS,
  WINDOW_TARGETS,
  BEGIN_MARKER,
  applyHeadlessPolicies,
  applyPolicies,
  policiesFor,
  type PolicyPreset,
} from '../gen-compaction-policies.ts'
import { regenerate } from '../gen-preset-air-lean.ts'

const patchText = readFileSync(join(import.meta.dirname, '..', '..', 'bundles', 'air', 'cordis.patch.yml'), 'utf8')
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (source: string) => `!!js ${source}` }
const presets: readonly PolicyPreset[] = ['lean', 'full']
/** Windows where the table itself says a full 4,096-token reply cannot be kept. */
const CANNOT_KEEP_FULL_REPLY: readonly [PolicyPreset, number][] = [['lean', 16384], ['full', 16384]]

interface Policy { provider: string; model: string; headroomTokens: number; retainTokens?: number; maxTokens: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the policies written into one preset row of the patch file text. */
function writtenPolicies(text: string, rowId: string): Policy[] {
  const parsed: unknown = parse(text, { customTags: [jsTag] })
  const patches = Array.isArray(parsed) ? parsed.filter(isRecord) : []
  const rows = patches.flatMap((patch) => {
    const inserted = patch['insert']
    return Array.isArray(inserted) ? inserted.filter(isRecord) : []
  })
  const row = rows.find(candidate => candidate['id'] === rowId)
  const config = row?.['config']
  const plugins = isRecord(config) && Array.isArray(config['plugins']) ? config['plugins'].filter(isRecord) : []
  const group = plugins.find(plugin => plugin['id'] === 'compaction')
  const members = group !== undefined && Array.isArray(group['config']) ? group['config'].filter(isRecord) : []
  const basic = members.find(member => member['id'] === 'compaction-basic')
  const basicConfig = basic?.['config']
  const policies = isRecord(basicConfig) ? basicConfig['modelPolicies'] : undefined
  if (!Array.isArray(policies)) throw new Error(`no modelPolicies in ${rowId}`)
  return policies.filter(isRecord).map(policy => ({
    provider: String(policy['provider']),
    model: String(policy['model']),
    headroomTokens: Number(policy['headroomTokens']),
    ...(policy['retainTokens'] === undefined ? {} : { retainTokens: Number(policy['retainTokens']) }),
    maxTokens: Number(policy['maxTokens']),
  }))
}

describe('compaction policies for local models', () => {
  it.each([['preset-air', 'full'], ['preset-air-lean', 'lean']] as const)('writes the table values of every model into %s', (rowId, preset) => {
    expect(writtenPolicies(patchText, rowId)).toEqual(policiesFor(preset))
  })

  it('lists exactly the documented local model ids and no hosted model', () => {
    const models = writtenPolicies(patchText, 'preset-air').map(policy => policy.model)
    expect(models).toEqual(Object.keys(MODEL_WINDOWS))
    expect(models).not.toContain('deepseek-flash')
    expect(new Set(writtenPolicies(patchText, 'preset-air').map(policy => policy.provider))).toEqual(new Set(['ollama']))
  })

  it('gives the measured values for the measured models', () => {
    const pick = (preset: PolicyPreset, model: string): Policy | undefined => policiesFor(preset).find(policy => policy.model === model)
    expect(pick('lean', 'qwen3-8b-16k')).toMatchObject({ headroomTokens: 3288, retainTokens: 800, maxTokens: 1024 })
    expect(pick('lean', 'qwen3-8b-32k')).toMatchObject({ headroomTokens: 8672, maxTokens: 2048 })
    expect(pick('full', 'qwen3-8b-16k')).toMatchObject({ headroomTokens: 1288, retainTokens: 600, maxTokens: 800 })
    expect(pick('full', 'qwen3-8b-32k')).toMatchObject({ headroomTokens: 6672, maxTokens: 2048 })
  })

  it.each(presets.flatMap(preset => Object.entries(MODEL_WINDOWS).map(([model, window]) => [preset, model, window] as const)))(
    'keeps the %s threshold of %s valid',
    (preset, model, window) => {
      const policy = policiesFor(preset).find(candidate => candidate.model === model)
      const threshold = window - RESERVED_OUTPUT_TOKENS - (policy?.headroomTokens ?? 0)
      expect(threshold).toBe(WINDOW_TARGETS[window]?.[preset].thresholdTokens)
      expect(window - RESERVED_OUTPUT_TOKENS - (policy?.headroomTokens ?? 0)).toBeGreaterThan(0)
      expect(threshold).toBeLessThan(window * 0.8)
      expect(policy?.retainTokens ?? 0).toBeLessThan(threshold)
      const keepsFullReply = threshold < window - FULL_REPLY_MARGIN
      expect(keepsFullReply).toBe(!CANNOT_KEEP_FULL_REPLY.some(([p, w]) => p === preset && w === window))
    },
  )

  it('keeps the derived 24K targets under the reply limit and above the prompt plus tail plus summary', () => {
    const window = 24576
    const tail = Math.floor((window - RESERVED_OUTPUT_TOKENS) * 0.16)
    for (const [preset, fixedPrompt] of [['lean', 5700], ['full', 9500]] as const) {
      const target = WINDOW_TARGETS[window]?.[preset]
      expect(target?.thresholdTokens).toBeLessThan(window - FULL_REPLY_MARGIN)
      expect((target?.thresholdTokens ?? 0)).toBeGreaterThan(fixedPrompt + tail + (target?.summaryMaxTokens ?? Infinity))
    }
  })

  it('leaves unknown model ids without a policy', () => {
    for (const preset of presets) expect(policiesFor(preset).some(policy => policy.model === 'qwen3:8b')).toBe(false)
  })

  it('detects a stale block and rewrites it back', () => {
    const stale = patchText.replace('headroomTokens: 8672', 'headroomTokens: 1')
    expect(stale).not.toBe(patchText)
    expect(applyPolicies(stale)).toBe(patchText)
  })

  it('composes with the lean generator in either order', () => {
    expect(regenerate(patchText)).toBe(patchText)
    expect(applyPolicies(regenerate(patchText))).toBe(patchText)
    expect(regenerate(applyPolicies(patchText))).toBe(patchText)
    expect(writtenPolicies(regenerate(patchText), 'preset-air-lean')).toEqual(policiesFor('lean'))
  })
})

describe('compaction policies in the headless bundle', () => {
  const headlessText = readFileSync(join(import.meta.dirname, '..', '..', 'bundles', 'air-headless', 'cordis.patch.yml'), 'utf8')

  it('writes the lean table values into the compaction-basic row', () => {
    const parsed: unknown = parse(headlessText, { customTags: [jsTag] })
    const rows = Array.isArray(parsed) ? parsed.filter(isRecord) : []
    const config = rows.find(row => row['id'] === 'compaction-basic')?.['config']
    const policies = isRecord(config) && Array.isArray(config['modelPolicies']) ? config['modelPolicies'] : []
    expect(policies).toEqual(policiesFor('lean'))
  })

  it('detects a stale block, rewrites it back, and leaves a current file unchanged', () => {
    const stale = headlessText.replace('headroomTokens: 8672', 'headroomTokens: 1')
    expect(stale).not.toBe(headlessText)
    expect(applyHeadlessPolicies(stale)).toBe(headlessText)
    expect(applyHeadlessPolicies(headlessText)).toBe(headlessText)
  })

  it('rejects a file with no marker pair or an unterminated block', () => {
    expect(() => applyHeadlessPolicies('- id: compaction-basic\n')).toThrow('exactly one policy marker pair')
    expect(() => applyHeadlessPolicies(`${BEGIN_MARKER}\n`)).toThrow('no end marker')
  })
})
