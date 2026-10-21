import { describe, expect, it } from 'vitest'
import { FRAME_AUDIO, FRAME_CONTROL, FrameDecoder, audioFrame, controlFrame, encodeFrame, parseControl, samplesOf } from '../src/core/frames.ts'

describe('frames', () => {
  it('round-trips audio and control frames split at any byte', () => {
    const samples = new Float32Array([0.5, -0.25, 1])
    const bytes = Buffer.concat([audioFrame(samples), controlFrame({ type: 'language', lang: 'ta' }), audioFrame(new Float32Array(0))])
    const decoder = new FrameDecoder()
    const frames = [...bytes].flatMap(byte => decoder.push(Buffer.from([byte])))
    expect(frames.map(frame => frame.kind)).toEqual([FRAME_AUDIO, FRAME_CONTROL, FRAME_AUDIO])
    expect(samplesOf(frames[0]!.payload)).toEqual(samples)
    expect(parseControl(frames[1]!.payload)).toEqual({ type: 'language', lang: 'ta' })
    expect(samplesOf(frames[2]!.payload)).toEqual(new Float32Array(0))
  })

  it('returns several frames from one chunk and keeps a partial one for later', () => {
    const decoder = new FrameDecoder()
    const two = Buffer.concat([encodeFrame(7, Buffer.from('ab')), encodeFrame(8, Buffer.from('c'))])
    expect(decoder.push(two.subarray(0, two.length - 1)).map(frame => frame.kind)).toEqual([7])
    expect(decoder.push(two.subarray(two.length - 1)).map(frame => frame.payload.toString())).toEqual(['c'])
  })

  it('reads samples from an unaligned payload and ignores trailing bytes', () => {
    const odd = Buffer.concat([Buffer.from([9]), Buffer.from(new Float32Array([2]).buffer), Buffer.from([1, 2])]).subarray(1)
    expect(samplesOf(odd)).toEqual(new Float32Array([2]))
  })

  it('accepts only known control messages', () => {
    expect(parseControl(Buffer.from('{"type":"language","lang":"en"}'))).toEqual({ type: 'language', lang: 'en' })
    expect(parseControl(Buffer.from('{"type":"language","lang":"fr"}'))).toBeUndefined()
    expect(parseControl(Buffer.from('{"type":"listen"}'))).toEqual({ type: 'listen' })
    expect(parseControl(Buffer.from('{"type":"listen","seconds":8}'))).toEqual({ type: 'listen', seconds: 8 })
    expect(parseControl(Buffer.from('{"type":"listen","seconds":-1}'))).toEqual({ type: 'listen' })
    expect(parseControl(Buffer.from('{"type":"other"}'))).toBeUndefined()
    expect(parseControl(Buffer.from('7'))).toBeUndefined()
    expect(parseControl(Buffer.from('null'))).toBeUndefined()
    expect(parseControl(Buffer.from('{oops'))).toBeUndefined()
  })
})
