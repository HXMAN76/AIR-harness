import { describe, expect, it } from 'vitest'
import { audioFrame, controlFrame } from '../src/core/frames.ts'
import { Listener, type Command } from '../src/core/listener.ts'
import { fakeSpawn } from './fake-child.ts'

interface Rig {
  listener: Listener
  fake: ReturnType<typeof fakeSpawn>
  commands: Command[]
  errors: Error[]
  ready: number[]
  events: string[]
}

function setup(): Rig {
  const fake = fakeSpawn()
  const listener = new Listener({ spawnFn: fake.spawn, command: 'node', workerPath: 'W.ts', modelsRoot: 'M', sherpaFrom: 'P.json', keywordsFile: 'K.txt' })
  const commands: Command[] = []
  const errors: Error[] = []
  const ready: number[] = []
  const events: string[] = []
  listener.on('command', (command: Command) => commands.push(command))
  for (const name of ['wake', 'timeout', 'language']) listener.on(name, (info?: unknown) => events.push(info === undefined ? name : `${name} ${JSON.stringify(info)}`))
  listener.on('error', (error: Error) => errors.push(error))
  listener.on('ready', (loadMs: number) => ready.push(loadMs))
  return { listener, fake, commands, errors, ready, events }
}

describe('Listener', () => {
  it('starts the worker once with the models root, the sherpa package path, and the keywords file', () => {
    const { listener, fake } = setup()
    listener.start()
    listener.start()
    expect(fake.calls).toEqual([{ command: 'node', args: ['W.ts', 'M', 'P.json', 'K.txt'] }])
  })

  it('has defaults for the worker command and paths', () => {
    expect(() => new Listener()).not.toThrow()
  })

  it('forwards audio as framed Float32 bytes and ignores frames when not running', async () => {
    const { listener, fake } = setup()
    listener.push(new Float32Array([1]))
    listener.start()
    const frame = new Float32Array([0.5, -0.25, 1])
    listener.push(frame)
    expect(fake.children[0]!.written).toEqual([audioFrame(frame)])
    await listener.stop()
    listener.push(frame)
    expect(fake.children[0]!.written).toHaveLength(1)
  })

  it('sends a language control frame, and again to a restarted worker', () => {
    const { listener, fake } = setup()
    listener.setLanguage('ta')
    listener.start()
    expect(fake.children[0]!.written).toEqual([controlFrame({ type: 'language', lang: 'ta' })])
    listener.setLanguage('en')
    expect(fake.children[0]!.written).toHaveLength(2)
    fake.children[0]!.exit(1)
    expect(fake.children[1]!.written).toEqual([])
  })

  it('asks the worker to listen without a wake word', () => {
    const { listener, fake } = setup()
    listener.listen()
    listener.start()
    listener.listen()
    expect(fake.children[0]!.written).toEqual([controlFrame({ type: 'listen' })])
  })

  it('turns JSON lines into events', () => {
    const { listener, fake, commands, ready, events } = setup()
    listener.start()
    fake.children[0]!.out('{"ready":true,"loadMs":4100}\n{"type":"wake"}\r\n')
    fake.children[0]!.out('{"type":"command","text":"open notepad","lang":"en","audioMs":1800,"decodeMs":90}\n{"type":"timeout"}\n{"type":"language","lang":"ta","loadMs":1500}\n')
    expect(ready).toEqual([4100])
    expect(commands).toEqual([{ text: 'open notepad', lang: 'en', audioMs: 1800, decodeMs: 90 }])
    expect(events).toEqual(['wake', 'timeout', 'language {"lang":"ta","loadMs":1500}'])
  })

  it('reports a worker error message as an error', () => {
    const { listener, fake, errors } = setup()
    listener.start()
    fake.children[0]!.out('{"type":"error","message":"cannot load ta model"}\n')
    expect(errors.map(error => error.message)).toEqual(['cannot load ta model'])
  })

  it('emits one error per malformed line and keeps running', () => {
    const { listener, fake, events, errors } = setup()
    listener.start()
    fake.children[0]!.out('not json\n{"type":"command","text":5}\nnull\n{"type":"language","lang":"fr","loadMs":1}\n\n{"type":"wake"}\n')
    expect(errors.map(error => error.message)).toEqual(Array.from({ length: 4 }, () => 'listener sent a malformed line'))
    expect(events).toEqual(['wake'])
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
