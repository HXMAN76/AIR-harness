/** Small WAV reader and resampler for the benchmarks. */
import { readFileSync } from 'node:fs'

/** Mono samples at their sample rate. */
export interface Pcm {
  samples: Float32Array
  sampleRate: number
}

/**
 * Read a RIFF WAV (PCM 8/16/24/32-bit or 32-bit float) and mix it to mono.
 * @param path - the file.
 * @throws when the file is not a supported WAV.
 */
export function readWav(path: string): Pcm {
  const bytes = readFileSync(path)
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`)
  let format = 1
  let channels = 1
  let sampleRate = 16_000
  let bits = 16
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = bytes.readUInt16LE(body)
      channels = bytes.readUInt16LE(body + 2)
      sampleRate = bytes.readUInt32LE(body + 4)
      bits = bytes.readUInt16LE(body + 14)
      if (format === 0xFFFE) format = bytes.readUInt16LE(body + 24)
    } else if (id === 'data') {
      const available = Math.min(size, bytes.length - body)
      const width = bits / 8
      const frames = Math.floor(available / (width * channels))
      const samples = new Float32Array(frames)
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0
        for (let channel = 0; channel < channels; channel++) {
          const at = body + (frame * channels + channel) * width
          if (format === 3 && bits === 32) sum += bytes.readFloatLE(at)
          else if (format === 1 && bits === 16) sum += bytes.readInt16LE(at) / 32_768
          else if (format === 1 && bits === 32) sum += bytes.readInt32LE(at) / 2_147_483_648
          else if (format === 1 && bits === 24) sum += bytes.readIntLE(at, 3) / 8_388_608
          else if (format === 1 && bits === 8) sum += (bytes.readUInt8(at) - 128) / 128
          else throw new Error(`${path}: unsupported WAV format ${format}/${bits}`)
        }
        samples[frame] = sum / channels
      }
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error(`${path} has no data chunk`)
}

/**
 * Windowed-sinc resampling to another rate (Hann window, 24 taps each side).
 * @param pcm - the input.
 * @param target - the output sample rate.
 */
export function resample(pcm: Pcm, target: number): Float32Array {
  if (pcm.sampleRate === target) return pcm.samples
  const ratio = target / pcm.sampleRate
  const cutoff = Math.min(1, ratio)
  const half = 24
  const out = new Float32Array(Math.floor(pcm.samples.length * ratio))
  for (let index = 0; index < out.length; index++) {
    const center = index / ratio
    const first = Math.ceil(center - half / cutoff)
    const last = Math.floor(center + half / cutoff)
    let sum = 0
    let weight = 0
    for (let at = first; at <= last; at++) {
      const x = (at - center) * cutoff
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const window = 0.5 + 0.5 * Math.cos(Math.PI * (at - center) * cutoff / half)
      const kernel = sinc * window
      weight += kernel
      const sample = pcm.samples[at]
      if (sample !== undefined) sum += sample * kernel
    }
    out[index] = weight === 0 ? 0 : sum / weight
  }
  return out
}
