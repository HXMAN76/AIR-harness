import { describe, expect, it } from 'vitest'
import { deriveAirOxlintConfig, parseJsonWithComments } from '../gen-oxlintrc.ts'

describe('deriveAirOxlintConfig', () => {
  it('rewrites package globs and drops non-package globs', () => {
    const derived = deriveAirOxlintConfig({
      $schema: './node_modules/oxlint/configuration_schema.json',
      ignorePatterns: ['**/lib/**', 'vendor/**', '**/*.js'],
      overrides: [
        { files: ['packages/*/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'], rules: { 'no-console': 'error' } },
        { files: ['packages/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'], rules: { eqeqeq: 'error' }, jsPlugins: ['eslint-plugin-sonarjs'] },
        { files: ['packages/typert/generator/tests/fixtures/type-model/**/*.{ts,tsx}'], rules: { 'typescript/no-explicit-any': 'off' } },
        { files: ['website/**/*.{ts,tsx}'], rules: { curly: 'error' } },
      ],
    })
    expect(derived.$schema).toBe('./node_modules/oxlint/configuration_schema.json')
    expect(derived.ignorePatterns).toEqual(['**/lib/**', '**/*.js'])
    expect(derived.overrides).toEqual([
      { files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'], rules: { 'no-console': 'error' } },
      { files: ['packages/**/*.{ts,tsx}'], rules: { eqeqeq: 'error' }, jsPlugins: ['eslint-plugin-sonarjs'] },
    ])
  })

  it('keeps top-level fields other than overrides and ignorePatterns', () => {
    const derived = deriveAirOxlintConfig({ options: { typeAware: true }, categories: { correctness: 'off' }, overrides: [] })
    expect(derived.options).toEqual({ typeAware: true })
    expect(derived.categories).toEqual({ correctness: 'off' })
    expect(derived.overrides).toEqual([])
  })
})

describe('parseJsonWithComments', () => {
  it('accepts line comments and trailing commas', () => {
    expect(parseJsonWithComments('{ "a": [1, 2,], // note\n "b": "x//y" }')).toEqual({ a: [1, 2], b: 'x//y' })
  })

  it('throws on invalid input', () => {
    expect(() => parseJsonWithComments('{ "a": ')).toThrow(/gen-oxlintrc/)
  })
})
