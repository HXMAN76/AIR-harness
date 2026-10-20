import { describe, expect, it } from 'vitest'
import { Listener, type Segment } from '../src/core/listener.ts'
import { fakeSpawn } from './fake-child.ts'

function setup(): { listener: Listener; fake: ReturnType<typeof fakeSpawn>; segments: Segment[]; errors: Error[]; ready: number[] } {
  const fake = fakeSpawn()
  const listener = new Listener({ spawnFn: fake.spawn, command: 'node', workerPath: 'W.ts', modelDir: 'M', sherpaFrom: 'P.json' })
  const segments: Segment[] = []
  const errors: Error[] = []
  const ready: number[] = []
  listener.on('segment', (segment: Segment) => segments.push(segment))
  listener.on('error', (error: Error) => errors.push(error))
  listener.on('ready', (loadMs: number) => ready.push(loadMs))
  return { listener, fake, segments, errors, ready }
}

describe('Listener', () => {
  it('starts the worker once with the model directory and the sherpa package path', () => {
    const { listener, fake } = setup()
    listener.start()
    listener.start()
    expect(fake.calls).toEqual([{ command: 'node', args: ['W.ts', 'M', 'P.json'] }])
  })

  it('has defaults for the worker command and paths', () => {
    expect(() => new Listener()).not.toThrow()
  })

  it('forwards frames as raw Float32 bytes and ignores frames when not running', async () => {
    const { listener, fake } = setup()
    listener.push(new Float32Array([1]))
    listener.start()
    const frame = new Float32Array([0.5, -0.25, 1])
    listener.push(frame)
    const written = fake.children[0]!.written[0] as Buffer
    expect(Buffer.isBuffer(written)).toBe(true)
    expect(new Float32Array(written.buffer, written.byteOffset, written.byteLength / 4)).toEqual(frame)
    await listener.stop()
    listener.push(frame)
    expect(fake.children[0]!.written).toHaveLength(1)
  })

  it('turns JSON lines into segments and ready events', () => {
    const { listener, fake, segments, ready } = setup()
    listener.start()
    fake.children[0]!.out('{"ready":true,"loadMs":4100}\n{"text":"Jarvis, open Notepad.","durationMs":1800}\r\n')
    expect(ready).toEqual([4100])
    expect(segments).toEqual([{ text: 'Jarvis, open Notepad.', durationMs: 1800 }])
  })

  it('emits one error per malformed line and keeps running', () => {
    const { listener, fake, segments, errors } = setup()
    listener.start()
    fake.children[0]!.out('not json\n{"text":5}\nnull\n\n{"text":"ok","durationMs":10}\n')
    expect(errors.map(error => error.message)).toEqual(Array.from({ length: 3 }, () => 'listener sent a malformed line'))
    expect(segments).toEqual([{ text: 'ok', durationMs: 10 }])
  })

  it('restarts the worker once after an unexpected exit, then reports it unavailable', () => {
    const { listener, fake, errors } = setup()
    listener.start()
    fake.children[0]!.exit(3)
    expect(fake.children).toHaveLength(2)
    fake.children[1]!.emit('error', new Error('spawn node ENOENT'))
    fake.children[1]!.exit(1)
    expect(fake.children).toHaveLength(2)
    expect(errors.map(error => error.message)).toEqual(['listener exited', 'listener exited', 'listener unavailable'])
    listener.start()
    expect(fake.children).toHaveLength(2)
  })

  it('swallows stdin write errors; the exit handler reports a dead worker', () => {
    const { listener, fake, errors } = setup()
    listener.start()
    expect(() => fake.children[0]!.stdin.emit('error', new Error('write EOF'))).not.toThrow()
    expect(errors).toEqual([])
  })

  it('stop() ends the worker without a restart or an error', async () => {
    const { listener, fake, errors } = setup()
    await listener.stop()
    listener.start()
    await listener.stop()
    expect(fake.children[0]!.ended).toBe(true)
    expect(fake.children[0]!.killed).toBe(true)
    expect(fake.children).toHaveLength(1)
    expect(errors).toEqual([])
  })
})
