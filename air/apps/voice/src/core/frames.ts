/** Wire format between the listener and its worker, plus the worker's JSON messages. Pure. */

/** Language of the active recogniser. */
export type Lang = 'en' | 'ta'

/** Frame kind byte: raw Float32 little-endian 16 kHz mono samples. */
export const FRAME_AUDIO = 0
/** Frame kind byte: one UTF-8 JSON control message. */
export const FRAME_CONTROL = 1

/** Bytes before each payload: kind (1) and payload length (uint32 LE, 4). */
const HEADER = 5

/** Control messages the parent sends to the worker. */
export type ControlMessage = { type: 'language'; lang: Lang } | { type: 'listen' }

/** Messages the worker writes to stdout, one JSON object per line. */
export type WorkerMessage =
  | { ready: true; loadMs: number }
  | { type: 'wake' }
  | { type: 'command'; text: string; lang: Lang; audioMs: number; decodeMs: number }
  | { type: 'timeout' }
  /** Text wake: speech was heard but did not start with a wake phrase; carries no text. */
  | { type: 'heard' }
  | { type: 'language'; lang: Lang; loadMs: number }
  | { type: 'error'; message: string }

/**
 * @param kind - {@link FRAME_AUDIO} or {@link FRAME_CONTROL}.
 * @param payload - frame body.
 * @returns header and payload as one buffer.
 */
export function encodeFrame(kind: number, payload: Uint8Array): Buffer {
  const out = Buffer.alloc(HEADER + payload.length)
  out.writeUInt8(kind, 0)
  out.writeUInt32LE(payload.length, 1)
  out.set(payload, HEADER)
  return out
}

/**
 * @param samples - 16 kHz mono samples.
 * @returns an audio frame.
 */
export function audioFrame(samples: Float32Array): Buffer {
  return encodeFrame(FRAME_AUDIO, new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength))
}

/**
 * @param message - control message.
 * @returns a control frame.
 */
export function controlFrame(message: ControlMessage): Buffer {
  return encodeFrame(FRAME_CONTROL, Buffer.from(JSON.stringify(message), 'utf8'))
}

/** One decoded frame. */
export interface Frame {
  kind: number
  payload: Buffer
}

/** Reassembles frames from stdin chunks of any size. */
export class FrameDecoder {
  private rest: Buffer = Buffer.alloc(0)

  /**
   * @param chunk - bytes read from stdin.
   * @returns every frame completed by this chunk.
   */
  push(chunk: Buffer): Frame[] {
    this.rest = Buffer.concat([this.rest, chunk])
    const frames: Frame[] = []
    while (this.rest.length >= HEADER) {
      const length = this.rest.readUInt32LE(1)
      if (this.rest.length < HEADER + length) break
      frames.push({ kind: this.rest.readUInt8(0), payload: this.rest.subarray(HEADER, HEADER + length) })
      this.rest = this.rest.subarray(HEADER + length)
    }
    return frames
  }
}

/**
 * @param payload - audio frame body.
 * @returns the samples (a copy, so alignment does not matter).
 */
export function samplesOf(payload: Buffer): Float32Array {
  const out = new Float32Array(Math.floor(payload.length / 4))
  for (let index = 0; index < out.length; index++) out[index] = payload.readFloatLE(index * 4)
  return out
}

/**
 * @param payload - control frame body.
 * @returns the message, or undefined when it is not a known control message.
 */
export function parseControl(payload: Buffer): ControlMessage | undefined {
  let value: unknown
  try {
    value = JSON.parse(payload.toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.type === 'listen') return { type: 'listen' }
  if (record.type === 'language' && (record.lang === 'en' || record.lang === 'ta')) return { type: 'language', lang: record.lang }
  return undefined
}
