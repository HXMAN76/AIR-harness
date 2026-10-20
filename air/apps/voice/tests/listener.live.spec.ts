/**
 * Opt-in: the real worker with the real models. `AIR_VOICE_LIVE=1 pnpm -C air/apps/voice exec vitest run tests/listener.live.spec.ts`
 * The fixture is SAPI speech of "Jarvis, open Note pad." (Microsoft David, rate -1) saved as 16 kHz mono 16-bit PCM.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Listener, type Segment } from '../src/core/listener.ts'
import { matchWake } from '../src/core/wake.ts'

function readPcm16Wav(path: string): Float32Array {
  const file = readFileSync(path)
  let offset = 12
  while (offset < file.length) {
    const id = file.toString('ascii', offset, offset + 4)
    const size = file.readUInt32LE(offset + 4)
    if (id === 'data') {
      const out = new Float32Array(size / 2)
      for (let index = 0; index < out.length; index++) out[index] = file.readInt16LE(offset + 8 + index * 2) / 32768
      return out
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

describe.runIf(process.env.AIR_VOICE_LIVE === '1')('Listener (live)', () => {
  it('transcribes the fixture into a wake command that mentions Notepad', async () => {
    const listener = new Listener()
    const segments: Segment[] = []
    const errors: Error[] = []
    listener.on('error', (error: Error) => errors.push(error))
    listener.on('segment', (segment: Segment) => segments.push(segment))
    listener.start()
    const audio = readPcm16Wav(fileURLToPath(new URL('fixtures/jarvis-open-notepad.wav', import.meta.url)))
    const silence = new Float32Array(24_000)
    for (const chunk of [silence, audio, silence]) {
      for (let offset = 0; offset < chunk.length; offset += 1600) listener.push(chunk.slice(offset, offset + 1600))
    }
    const deadline = Date.now() + 60_000
    while (segments.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    await new Promise(resolve => setTimeout(resolve, 1000))
    await listener.stop()
    console.log('segments', JSON.stringify(segments))
    expect(errors).toEqual([])
    // A pause after the wake word can split it into its own segment; the controller then takes the next segment as the command.
    const wake = matchWake(segments[0]!.text)
    expect(wake.wake).toBe(true)
    const command = wake.command === '' ? segments[1]?.text ?? '' : wake.command
    expect(command.toLowerCase()).toContain('notepad')
  }, 120_000)
})
