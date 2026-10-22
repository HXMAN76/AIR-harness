import { describe, expect, it } from 'vitest'
import { Speaker, type AudioPlayer } from '../src/core/speaker.ts'
import { fakeSpawn } from './fake-child.ts'

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/** A player that records calls and lets a test finish each playback by hand. */
function fakePlayer(): AudioPlayer & { played: string[]; finish: ((error?: Error) => void)[]; stops: number; beeps: number } {
  const player = {
    played: [] as string[],
    finish: [] as ((error?: Error) => void)[],
    stops: 0,
    beeps: 0,
    play(wav: string): Promise<void> {
      player.played.push(wav)
      return new Promise<void>((resolve, reject) => {
        player.finish.push((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    },
    stop(): void {
      player.stops++
    },
    beep(): void {
      player.beeps++
    },
  }
  return player
}

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

  it('writes SAY with base64 UTF-8, plays the returned WAV and resolves when playback ends', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    let settled = false
    const done = speaker.speak('hi').then(() => {
      settled = true
    })
    await flush()
    expect(fake.children[0]!.text).toBe('SAY aGk=\n')
    expect(speaker.speaking).toBe(true)
    fake.children[0]!.out('WAV QUJD')
    fake.children[0]!.out('\r\n')
    await flush()
    expect(player.played).toEqual(['QUJD'])
    expect(settled).toBe(false)
    expect(speaker.speaking).toBe(true)
    player.finish[0]!()
    await done
    expect(speaker.speaking).toBe(false)
  })

  it('plays queued utterances in order and ignores other lines', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    const order: string[] = []
    const first = speaker.speak('a').then(() => order.push('a'))
    const second = speaker.speak('b').then(() => order.push('b'))
    fake.children[0]!.out('READY\nWAV AA==\n\nWAV QQ==\n')
    await flush()
    expect(player.played).toEqual(['AA==', 'QQ=='])
    player.finish[0]!()
    player.finish[1]!()
    await Promise.all([first, second])
    expect(order).toEqual(['a', 'b'])
    fake.children[0]!.out('DONE\nWAV AA==\n')
    expect(speaker.speaking).toBe(false)
    expect(player.played).toHaveLength(2)
  })

  it('settles an utterance whose playback failed', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    const done = speaker.speak('a')
    fake.children[0]!.out('WAV AA==\n')
    await flush()
    player.finish[0]!(new Error('decode failed'))
    await done
    expect(speaker.speaking).toBe(false)
  })

  it('without a player the WAV is dropped and speech still resolves', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    const done = speaker.speak('a')
    fake.children[0]!.out('WAV AA==\n')
    await done
    speaker.beep()
    speaker.stop()
    expect(speaker.speaking).toBe(false)
  })

  it('speaks sentence by sentence: the first plays while the next are still rendering', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    let settled = false
    const done = speaker.speak('Good evening to you. I can read your mail today.').then(() => {
      settled = true
    })
    expect(fake.children[0]!.text).toBe(`SAY ${Buffer.from('Good evening to you.').toString('base64')}\nSAY ${Buffer.from('I can read your mail today.').toString('base64')}\n`)
    fake.children[0]!.out('WAV AA==\n')
    await flush()
    expect(player.played).toEqual(['AA=='])
    expect(speaker.speaking).toBe(true)
    fake.children[0]!.out('WAV QQ==\n')
    await flush()
    player.finish[0]!()
    await flush()
    expect(settled).toBe(false)
    expect(speaker.speaking).toBe(true)
    player.finish[1]!()
    await done
    expect(speaker.speaking).toBe(false)
  })

  it('speaks text without words as one piece', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn)
    const done = speaker.speak('...')
    expect(fake.children[0]!.text).toBe(`SAY ${Buffer.from('...').toString('base64')}\n`)
    fake.children[0]!.out('DONE\n')
    await done
  })

  it('stop() cancels the sentences still rendering', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    const done = speaker.speak('Good evening to you. I can read your mail today.')
    fake.children[0]!.out('WAV AA==\n')
    await flush()
    speaker.stop()
    await done
    expect(player.stops).toBe(1)
    fake.children[0]!.out('WAV QQ==\n')
    await flush()
    expect(player.played).toEqual(['AA=='])
  })

  it('uses the preferred engine first and falls back to SAPI after it fails twice', async () => {
    const fake = fakeSpawn()
    const speaker = new Speaker(fake.spawn, 'C:/voice/speaker.ps1', undefined, { command: 'node', args: ['tts-worker.cjs', 'dir'] })
    const first = speaker.speak('a')
    fake.children[0]!.exit(1)
    await expect(first).rejects.toThrow('speaker exited')
    const second = speaker.speak('b')
    fake.children[1]!.exit(1)
    await expect(second).rejects.toThrow('speaker exited')
    const third = speaker.speak('c')
    expect(fake.calls.map(call => call.command)).toEqual(['node', 'node', 'powershell.exe'])
    expect(fake.calls[0]!.args).toEqual(['tts-worker.cjs', 'dir'])
    fake.children[2]!.out('DONE\n')
    await third
    fake.children[2]!.exit(1)
    fake.children[2]!.emit('error', new Error('x'))
    const fourth = speaker.speak('d')
    fake.children[3]!.exit(1)
    await expect(fourth).rejects.toThrow('speaker exited')
    await expect(speaker.speak('e')).rejects.toThrow('speaker unavailable')
  })

  it('starts nothing until the first utterance', () => {
    expect(new Speaker().speaking).toBe(false)
  })

  it('stop() writes STOP, stops playback, resolves pending speech at once, and swallows late answers', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    const pending = speaker.speak('a long reply')
    speaker.stop()
    await pending
    expect(fake.children[0]!.text).toBe(`SAY ${Buffer.from('a long reply').toString('base64')}\nSTOP\n`)
    expect(player.stops).toBe(1)
    expect(speaker.speaking).toBe(false)
    let settled = false
    const next = speaker.speak('next').then(() => {
      settled = true
    })
    fake.children[0]!.out('WAV AA==\n')
    await flush()
    expect(settled).toBe(false)
    expect(player.played).toEqual([])
    fake.children[0]!.out('WAV QQ==\n')
    await flush()
    player.finish[0]!()
    await next
    expect(player.played).toEqual(['QQ=='])
  })

  it('stop() while an answered utterance is playing does not swallow the next answer', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    const first = speaker.speak('a')
    fake.children[0]!.out('WAV AA==\n')
    await flush()
    speaker.stop()
    await first
    const second = speaker.speak('b')
    fake.children[0]!.out('WAV QQ==\n')
    await flush()
    player.finish[1]!()
    await second
    player.finish[0]!()
    await flush()
    expect(player.played).toEqual(['AA==', 'QQ=='])
  })

  it('warm() starts the child; beep() goes to the player without touching the child', () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    speaker.warm()
    speaker.beep()
    expect(fake.children).toHaveLength(1)
    expect(fake.children[0]!.text).toBe('')
    expect(player.beeps).toBe(1)
    expect(speaker.speaking).toBe(false)
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

  it('dispose() ends stdin, kills the child, stops playback and refuses later speech', async () => {
    const fake = fakeSpawn()
    const player = fakePlayer()
    const speaker = new Speaker(fake.spawn, undefined, player)
    const pending = speaker.speak('a')
    await speaker.dispose()
    await expect(pending).rejects.toThrow('speaker exited')
    expect(fake.children[0]!.ended).toBe(true)
    expect(fake.children[0]!.killed).toBe(true)
    expect(player.stops).toBe(1)
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
