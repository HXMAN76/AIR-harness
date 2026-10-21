import { describe, expect, it } from 'vitest'
import { MODEL_WINDOWS, RESERVED_OUTPUT_TOKENS, WINDOW_TARGETS, policiesFor } from '../gen-compaction-policies.ts'
import { WINDOWS, evaluate, shippedAirConfigs, thresholdTable, type ThresholdRow } from '../research/e2-threshold-table.ts'

/** Independent re-derivation of upstream's pressure threshold, used to check the imported function. */
function rederived(window: number, reserved: number, headroom: number, ratio: number): number | undefined {
  const budget = window - reserved - headroom
  if (budget <= 0) return undefined
  return Math.floor(Math.min(window * ratio, budget))
}

const rows = thresholdTable()
const row = (window: number, arm: ThresholdRow['arm']): ThresholdRow | undefined =>
  rows.find(candidate => candidate.window === window && candidate.arm === arm)

describe('E2 threshold table', () => {
  it('has one row per window and arm', () => {
    expect(rows).toHaveLength(WINDOWS.length * 3)
  })

  it.each(rows.map(candidate => [candidate.window, candidate.arm, candidate] as const))(
    'matches the re-derived formula at %i tokens for %s',
    (window, _arm, candidate) => {
      const expected = rederived(window, candidate.reservedOutputTokens, candidate.headroomTokens, candidate.thresholdRatio)
      expect(candidate.thresholdTokens).toBe(expected)
      expect(candidate.outcome === 'never compacts').toBe(candidate.pressureBudgetTokens <= 0)
    },
  )

  it('never compacts under upstream defaults up to a 64K window', () => {
    for (const window of [4096, 8192, 16384, 24576, 32768, 65536]) {
      expect(row(window, 'upstream-default')).toMatchObject({ headroomTokens: 65536, outcome: 'never compacts', thresholdTokens: undefined })
    }
  })

  it('gives the upstream thresholds for 128K and 200K windows', () => {
    expect(row(131072, 'upstream-default')).toMatchObject({ thresholdTokens: 61440, outcome: 'compacts', summaryMaxTokens: 65536 })
    expect(row(200000, 'upstream-default')).toMatchObject({ thresholdTokens: 130368, outcome: 'compacts' })
  })

  it('reaches the table thresholds of gen-compaction-policies for every AIR model window', () => {
    for (const [window, targets] of Object.entries(WINDOW_TARGETS)) {
      expect(row(Number(window), 'air-full')).toMatchObject({ policyMatched: true, thresholdTokens: targets.full.thresholdTokens, outcome: 'compacts' })
      expect(row(Number(window), 'air-lean')).toMatchObject({ policyMatched: true, thresholdTokens: targets.lean.thresholdTokens, outcome: 'compacts' })
    }
  })

  it('reads the same policies from the shipped patch as the generator writes', () => {
    const shipped = shippedAirConfigs()
    expect(shipped['air-full'].modelPolicies).toEqual(policiesFor('full'))
    expect(shipped['air-lean'].modelPolicies).toEqual(policiesFor('lean'))
  })

  it('evaluates every AIR model id to its window target', () => {
    const shipped = shippedAirConfigs()
    for (const window of new Set(Object.values(MODEL_WINDOWS))) {
      const full = evaluate('air-full', shipped['air-full'], window)
      expect(full.thresholdTokens).toBe(WINDOW_TARGETS[window]?.full.thresholdTokens)
      expect(full.reservedOutputTokens).toBe(RESERVED_OUTPUT_TOKENS)
    }
  })

  it('marks a threshold at or below the fixed prompt as compacting every step', () => {
    const shipped = shippedAirConfigs()
    expect(evaluate('air-lean', shipped['air-lean'], 16384, { fixedPromptTokens: 9000 }).outcome).toBe('compacts every step')
    expect(evaluate('air-lean', shipped['air-lean'], 16384, { fixedPromptTokens: 8999 }).outcome).toBe('compacts')
  })
})
