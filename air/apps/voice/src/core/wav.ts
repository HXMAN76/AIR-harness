/** Minimal WAV encoding for synthesised speech. Pure. */

/**
 * Encode mono float samples as a 16-bit PCM WAV.
 * @param samples - samples in -1..1 (clipped).
 * @param sampleRate - samples per second.
 * @returns the WAV file bytes.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = samples.length * 2
  const wav = Buffer.alloc(44 + data)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + data, 4)
  wav.write('WAVEfmt ', 8, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(data, 40)
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i] as number))
    wav.writeInt16LE(Math.round(clipped * 32_767), 44 + i * 2)
  }
  return wav
}
