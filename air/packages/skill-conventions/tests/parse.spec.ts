import { describe, expect, it } from 'vitest'
import { parseSkillText, type ParseOptions } from '../src/parse.ts'

const skill: ParseOptions = { fallbackName: 'from-dir', flat: false, descriptionMaxChars: 1500 }
const flat: ParseOptions = { ...skill, flat: true }

describe('parseSkillText', () => {
  it('reads name, description, when_to_use, and body', () => {
    expect(parseSkillText('---\nname: pdf-tools\ndescription: Work with PDFs\nwhen_to_use: For PDF files\n---\n\n# PDF\nSteps.\n', skill)).toEqual({
      name: 'pdf-tools',
      description: 'Work with PDFs',
      whenToUse: 'For PDF files',
      invocation: { modelInvocable: true, userInvocable: true },
      body: '# PDF\nSteps.',
    })
  })

  it('accepts the camelCase whenToUse spelling', () => {
    expect(parseSkillText('---\ndescription: D\nwhenToUse: Sometimes\n---\nB', skill)?.whenToUse).toBe('Sometimes')
  })

  it('defaults the name to the directory name, normalised to kebab-case', () => {
    expect(parseSkillText('---\ndescription: D\n---\nB', { ...skill, fallbackName: 'My Skill' })?.name).toBe('my-skill')
    expect(parseSkillText('---\nname: Fancy Name\ndescription: D\n---\nB', skill)?.name).toBe('fancy-name')
  })

  it('defaults the description to the first body paragraph without heading marks', () => {
    expect(parseSkillText('\n\n# Deploy helper\nruns the deploy\n\nSecond paragraph.', skill)?.description).toBe('Deploy helper runs the deploy')
  })

  it('caps the description', () => {
    const parsed = parseSkillText(`---\ndescription: ${'x'.repeat(40)}\n---\nB`, { ...skill, descriptionMaxChars: 10 })
    expect(parsed?.description).toBe(`${'x'.repeat(9)}…`)
  })

  it('reads the invocation flags', () => {
    const parsed = parseSkillText('---\ndescription: D\ndisable-model-invocation: true\nuser-invocable: false\n---\nB', skill)
    expect(parsed?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it('keeps metadata and records Claude Code fields under metadata.claudeCode', () => {
    const parsed = parseSkillText([
      '---',
      'description: D',
      'metadata:',
      '  author: someone',
      'allowed-tools: Bash(git add:*), Read',
      'disallowed-tools: [Write]',
      'arguments: issue branch',
      'paths: ["src/**/*.ts"]',
      'model: sonnet',
      'context: fork',
      'agent: reviewer',
      'argument-hint: "[issue]"',
      '---',
      'B',
    ].join('\n'), skill)
    expect(parsed?.metadata).toEqual({
      author: 'someone',
      claudeCode: {
        allowedTools: ['Bash(git add:*)', 'Read'],
        disallowedTools: ['Write'],
        arguments: ['issue', 'branch'],
        paths: ['src/**/*.ts'],
        model: 'sonnet',
        context: 'fork',
        agent: 'reviewer',
        argumentHint: '[issue]',
      },
    })
  })

  it('throws for an unusable name, a missing description, and a bad flag', () => {
    expect(() => parseSkillText('---\nname: "***"\ndescription: D\n---\nB', skill)).toThrow('invalid skill name "***"')
    expect(() => parseSkillText('---\nname: x\n---\n', skill)).toThrow('no description in frontmatter or body')
    expect(() => parseSkillText('---\ndescription: D\nuser-invocable: perhaps\n---\nB', skill)).toThrow('must be a boolean')
  })

  it('accepts a flat file only when its frontmatter has a description', () => {
    expect(parseSkillText('# Project notes\nNot a skill.', flat)).toBeUndefined()
    expect(parseSkillText('---\nname: x\n---\nBody', flat)).toBeUndefined()
    expect(parseSkillText('---\ndescription: A flat skill\n---\nBody', flat)?.name).toBe('from-dir')
  })
})
