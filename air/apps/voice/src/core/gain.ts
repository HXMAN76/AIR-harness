/** Input gain for the keyword spotter only. Pure apart from its tracked peak. */

/** Peak level the spotter is fed when the signal is quiet. */
export const GAIN_TARGET_PEAK = 0.3

/** Largest boost. Capped so a silent room does not turn its noise floor into speech-sized audio. */
export const GAIN_MAX = 8

/** Per-chunk decay of the tracked peak (a 100 ms chunk: the peak halves in about 2.3 s). */
export const GAIN_PEAK_DECAY = 0.97

/**
 * Boosts quiet audio towards {@link GAIN_TARGET_PEAK} and never attenuates it. Measured 2026-10-22: a
 * SAPI "Jarvis, open notepad." that Parakeet transcribes exactly (peak 0.07) fires the spotter at none of
 * the thresholds 0.05 to 0.25, and fires at all of them once amplified 2x or more. A louder chunk lowers the
 * gain at once; the tracked peak decays slowly so the gain rises again between utterances.
 */
export class SpotterGain {
  private peak = 0

  /**
   * Apply the current gain to one chunk.
   * @param samples - mono 16 kHz samples in [-1, 1]; not modified.
   * @returns the chunk itself when the gain is 1, else a boosted copy clipped to [-1, 1].
   */
  apply(samples: Float32Array): Float32Array {
    let chunkPeak = 0
    for (const sample of samples) chunkPeak = Math.max(chunkPeak, Math.abs(sample))
    this.peak = Math.max(chunkPeak, this.peak * GAIN_PEAK_DECAY)
    const gain = this.peak === 0 ? 1 : Math.min(GAIN_MAX, Math.max(1, GAIN_TARGET_PEAK / this.peak))
    if (gain === 1) return samples
    const boosted = new Float32Array(samples.length)
    for (let index = 0; index < samples.length; index++) boosted[index] = Math.max(-1, Math.min(1, (samples[index] as number) * gain))
    return boosted
  }
}
