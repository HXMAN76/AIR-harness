import { describe, expect, it } from 'vitest'
import { Speaker } from '../src/core/speaker.ts'
import { fakeSpawn } from './fake-child.ts'

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('Speaker', () => {
  it('spawns PowerShell with the SAPI script once', async () => {
    const fake = fakeSpawn(child => child.on('stdin', () => {
      child.out('DONE\r\n')
    }))
    const speaker = new Speaker(fake.spawn, 'C:/voice/speaker.ps1')
    await speaker.speak('one')
    await speaker.speak('two')
    expect(fake.calls).toEqual([{
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/voice/speaker.ps1'],
    }])
  })

  it('writes SAY with base64 UTF-8 and resolves on DONE', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    let settled = false
    const done = speaker.speak('hi').then(() => {
      settled = true
    })
    await flush()
    expect(fake.children[0]!.text).toBe('SAY aGk=\n')
    expect(speaker.speaking).toBe(true)
    expect(settled).toBe(false)
    fake.children[0]!.out('DO')
    fake.children[0]!.out('NE\n')
    await done
    expect(speaker.speaking).toBe(false)
  })

  it('resolves queued utterances in order and ignores other lines', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    const order: string[] = []
    const first = speaker.speak('a').then(() => order.push('a'))
    const second = speaker.speak('b').then(() => order.push('b'))
    fake.children[0]!.out('READY\nDONE\n\nDONE\n')
    await Promise.all([first, second])
    expect(order).toEqual(['a', 'b'])
    fake.children[0]!.out('DONE\n')
    expect(speaker.speaking).toBe(false)
  })

  it('starts nothing until the first utterance', () => {
    expect(new Speaker().speaking).toBe(false)
  })

  it('stop() writes STOP, resolves pending speech at once, and swallows the late DONE lines', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    const pending = speaker.speak('a long reply')
    speaker.stop()
    await pending
    expect(fake.children[0]!.text).toBe(`SAY ${Buffer.from('a long reply').toString('base64')}\nSTOP\n`)
    expect(speaker.speaking).toBe(false)
    let settled = false
    const next = speaker.speak('next').then(() => {
      settled = true
    })
    fake.children[0]!.out('DONE\n')
    await flush()
    expect(settled).toBe(false)
    fake.children[0]!.out('DONE\n')
    await next
  })

  it('warm() starts the child; beep() writes BEEP without queueing speech', () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    speaker.warm()
    speaker.beep()
    expect(fake.children).toHaveLength(1)
    expect(fake.children[0]!.text).toBe('BEEP\n')
    expect(speaker.speaking).toBe(false)
  })

  it('beep() is ignored once the child cannot start', () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    speaker.warm()
    fake.children[0]!.exit(1)
    speaker.warm()
    fake.children[1]!.exit(1)
    speaker.beep()
    expect(fake.children).toHaveLength(2)
  })

  it('stop() with nothing to say writes nothing', () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    speaker.stop()
    expect(fake.children).toHaveLength(0)
  })

  it('rejects pending speech when the child exits, respawns once, then gives up', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    const first = speaker.speak('a')
    fake.children[0]!.exit(1)
    await expect(first).rejects.toThrow('speaker exited')
    const second = speaker.speak('b')
    expect(fake.children).toHaveLength(2)
    fake.children[1]!.emit('error', new Error('spawn powershell.exe ENOENT'))
    fake.children[1]!.exit(1)
    await expect(second).rejects.toThrow('speaker exited')
    await expect(speaker.speak('c')).rejects.toThrow('speaker unavailable')
    expect(fake.children).toHaveLength(2)
  })

  it('dispose() ends stdin, kills the child, and refuses later speech', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    const pending = speaker.speak('a')
    await speaker.dispose()
    await expect(pending).rejects.toThrow('speaker exited')
    expect(fake.children[0]!.ended).toBe(true)
    expect(fake.children[0]!.killed).toBe(true)
    await expect(speaker.speak('b')).rejects.toThrow('speaker disposed')
    await speaker.dispose()
  })

  it('swallows stdin write errors', () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    void speaker.speak('a').catch(() => undefined)
    expect(() => fake.children[0]!.stdin.emit('error', new Error('write EPIPE'))).not.toThrow()
  })

  it('dispose() before any speech does nothing', async () => {
    const fake = fakeSpawn()
    await new Speaker(fake.spawn).dispose()
    expect(fake.children).toHaveLength(0)
  })
})
