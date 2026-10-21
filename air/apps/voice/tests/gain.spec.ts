import { describe, expect, it } from 'vitest'
import { GAIN_MAX, GAIN_PEAK_DECAY, GAIN_TARGET_PEAK, SpotterGain } from '../src/core/gain.ts'

const chunk = (value: number, length = 1600): Float32Array => new Float32Array(length).fill(value)

describe('SpotterGain', () => {
  it('returns digital silence unchanged', () => {
    const silence = chunk(0)
    expect(new SpotterGain().apply(silence)).toBe(silence)
  })

  it('boosts quiet audio to the target peak without modifying the input', () => {
    const quiet = chunk(0.07)
    const out = new SpotterGain().apply(quiet)
    expect(out).not.toBe(quiet)
    expect(out[0]).toBeCloseTo(GAIN_TARGET_PEAK, 5)
    expect(quiet[0]).toBeCloseTo(0.07, 5)
  })

  it('caps the boost so a silent room is not turned into speech-sized noise', () => {
    const out = new SpotterGain().apply(chunk(0.001))
    expect(out[0]).toBeCloseTo(0.001 * GAIN_MAX, 6)
  })

  it('never attenuates: audio at or above the target passes through as the same array', () => {
    const gain = new SpotterGain()
    const loud = chunk(0.9)
    expect(gain.apply(loud)).toBe(loud)
    const target = chunk(GAIN_TARGET_PEAK)
    expect(new SpotterGain().apply(target)).toBe(target)
  })

  it('clips boosted samples to [-1, 1]', () => {
    const gain = new SpotterGain()
    gain.apply(chunk(0.04))
    const spike = new Float32Array([0.04, -0.04, 0.2])
    const out = gain.apply(spike)
    expect(out[2]).toBeLessThanOrEqual(1)
    expect(out[1]).toBeLessThan(0)
  })

  it('lowers the gain at once for a louder chunk, and lets it recover as the tracked peak decays', () => {
    const gain = new SpotterGain()
    gain.apply(chunk(0.05))
    const loud = gain.apply(chunk(0.5))
    expect(loud[0]).toBeCloseTo(0.5, 5)
    const after = gain.apply(chunk(0.05))
    expect(after[0]).toBeCloseTo(0.05 * Math.max(1, GAIN_TARGET_PEAK / (0.5 * GAIN_PEAK_DECAY)), 5)
    let recovered = after
    for (let index = 0; index < 200; index++) recovered = gain.apply(chunk(0.05))
    expect(recovered[0]).toBeCloseTo(GAIN_TARGET_PEAK, 3)
  })
})
