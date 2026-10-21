/**
 * Record the default microphone headlessly (offscreen Electron window, no UI) and write a 16-bit WAV.
 * Captures through the same pipeline as the app renderer: getUserMedia with echo cancellation and
 * noise suppression, an AudioContext at 16 kHz, and the app's `capture-worklet.js` frames.
 *
 * `pnpm -C air/apps/voice exec tsx scripts/record-mic.ts [seconds] [out.wav]` (defaults: 6, `mic.wav`).
 * Env: `AIR_RECORD_RAW=1` disables echo cancellation and noise suppression for diagnosis.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VOICE_APP_ROOT } from '../src/core/paths.ts'

/** Electron main script: hidden window, grants the media permission, receives the WAV over IPC and exits. */
const MAIN_CJS = `
const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const seconds = Number(process.argv[2] ?? '6')
const out = process.argv[3]
const logPath = process.argv[4]

function log(message) {
  try { fs.appendFileSync(logPath, message + '\\n') } catch {}
  console.error('record-mic: ' + message)
}

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    log('permission ' + permission + ' granted=' + String(permission === 'media'))
    callback(permission === 'media')
  })
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  })
  ipcMain.on('log', (_event, message) => log('renderer: ' + message))
  let finished = false
  ipcMain.on('wav', (_event, data) => {
    fs.writeFileSync(out, Buffer.from(data))
    log('wrote ' + out + ' (' + data.byteLength + ' bytes)')
    finished = true
    app.exit(0)
  })
  ipcMain.on('fail', (_event, message) => {
    log('renderer failed: ' + message)
    finished = true
    app.exit(1)
  })
  win.on('closed', () => {
    if (finished) return
    log('window closed before the recording finished')
    app.exit(1)
  })
  void win.loadFile(path.join(__dirname, 'index.html')).catch((error) => {
    log('load failed: ' + String(error))
    finished = true
    app.exit(1)
  })
  setTimeout(() => {
    log('timed out after ' + (seconds + 25) + 's')
    finished = true
    app.exit(1)
  }, (seconds + 25) * 1000)
})
`

/** Renderer script: captures `seconds` of audio and sends one WAV buffer to the main process. */
const RENDERER_JS = `
const { ipcRenderer } = require('electron')
const SECONDS = __SECONDS__
const RATE = 16000

function log(message) {
  ipcRenderer.send('log', message)
}

function wavBuffer(samples, sampleRate) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + samples.length * 2, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sampleRate, 24)
  data.writeUInt32LE(sampleRate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), 44 + i * 2)
  }
  return data
}

async function main() {
  log('renderer started')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: RATE, echoCancellation: !__RAW__, noiseSuppression: !__RAW__ },
  })
  log('getUserMedia ok (raw=' + String(__RAW__) + ')')
  const ctx = new AudioContext({ sampleRate: RATE })
  await ctx.audioWorklet.addModule('capture-worklet.js')
  log('worklet loaded, ctx.sampleRate=' + ctx.sampleRate)
  const node = new AudioWorkletNode(ctx, 'capture-processor')
  const target = Math.round(ctx.sampleRate * SECONDS)
  const chunks = []
  let total = 0
  let done = false
  node.port.onmessage = (event) => {
    if (done) return
    chunks.push(event.data)
    total += event.data.length
    if (total < target) return
    done = true
    const samples = new Float32Array(target)
    let offset = 0
    for (const chunk of chunks) {
      const take = Math.min(chunk.length, target - offset)
      samples.set(chunk.subarray(0, take), offset)
      offset += take
      if (offset >= target) break
    }
    stream.getTracks().forEach((track) => track.stop())
    log('captured ' + total + ' samples, sending wav')
    ipcRenderer.send('wav', new Uint8Array(wavBuffer(samples, ctx.sampleRate)))
  }
  ctx.createMediaStreamSource(stream).connect(node)
}

main().catch((error) => ipcRenderer.send('fail', (error && error.stack) ? error.stack : String(error)))
`

/** Minimal WAV reader: returns mono Float32 samples of a 16-bit PCM file. */
export interface WavData {
  samples: Float32Array
  sampleRate: number
}

/**
 * Read a 16-bit PCM WAV file.
 * @param path - file to read.
 * @returns samples and sample rate.
 */
export function readWav(path: string): WavData {
  const file = readFileSync(path)
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a RIFF/WAVE file`)
  let offset = 12
  let sampleRate = 0
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4)
    const size = file.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      if (file.readUInt16LE(offset + 8) !== 1) throw new Error(`${path}: not PCM`)
      if (file.readUInt16LE(offset + 10) !== 1) throw new Error(`${path}: not mono`)
      if (file.readUInt16LE(offset + 22) !== 16) throw new Error(`${path}: not 16-bit`)
      sampleRate = file.readUInt32LE(offset + 12)
    }
    if (id === 'data') {
      const count = Math.floor(size / 2)
      const samples = new Float32Array(count)
      for (let index = 0; index < count; index++) samples[index] = file.readInt16LE(offset + 8 + index * 2) / 32768
      return { samples, sampleRate }
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`${path}: no data chunk`)
}

/**
 * Record the default microphone to a WAV file with a hidden Electron window.
 * @param seconds - how long to capture (default 6).
 * @param outPath - WAV file to write (default `mic.wav` in the working directory).
 * @returns resolves when the file is written.
 */
export async function recordMic(seconds = 6, outPath = 'mic.wav'): Promise<string> {
  const out = resolve(outPath)
  const electronPath = createRequire(join(VOICE_APP_ROOT, 'package.json'))('electron') as string
  if (typeof electronPath !== 'string' || !existsSync(electronPath)) throw new Error(`electron binary not found (${String(electronPath)})`)
  const dir = mkdtempSync(join(tmpdir(), 'air-record-mic-'))
  try {
    writeFileSync(join(dir, 'main.cjs'), MAIN_CJS, 'utf8')
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><script src="renderer.js"></script></body></html>', 'utf8')
    writeFileSync(join(dir, 'renderer.js'), RENDERER_JS.replace('__SECONDS__', String(seconds)).replaceAll('__RAW__', process.env['AIR_RECORD_RAW'] === '1' ? 'true' : 'false'), 'utf8')
    copyFileSync(join(VOICE_APP_ROOT, 'src', 'renderer', 'capture-worklet.js'), join(dir, 'capture-worklet.js'))
    const logPath = join(dir, 'log.txt')
    await new Promise<void>((resolveRun, rejectRun) => {
      const child = spawn(electronPath, [join(dir, 'main.cjs'), String(seconds), out, logPath, `--user-data-dir=${join(dir, 'profile')}`, '--enable-logging'], { stdio: 'inherit' })
      const killer = setTimeout(() => {
        child.kill()
        rejectRun(new Error(`recording did not finish within ${seconds + 40}s`))
      }, (seconds + 40) * 1000)
      child.on('error', (error: Error) => {
        clearTimeout(killer)
        rejectRun(error)
      })
      child.on('exit', (code) => {
        clearTimeout(killer)
        const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : '(no log)'
        if (code === 0) resolveRun()
        else rejectRun(new Error(`electron exited with code ${String(code)}\n--- record log ---\n${logText}`))
      })
    })
    const stats = statSync(out)
    if (stats.size <= 44) throw new Error(`${out} is empty`)
    const { samples, sampleRate } = readWav(out)
    let peak = 0
    let squares = 0
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample))
      squares += sample * sample
    }
    console.log(`wrote ${out}: ${(samples.length / sampleRate).toFixed(1)}s ${sampleRate}Hz, peak ${peak.toFixed(3)}, rms ${Math.sqrt(squares / samples.length).toFixed(4)}`)
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seconds = process.argv[2] === undefined ? 6 : Number(process.argv[2])
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.error('usage: record-mic.ts [seconds] [out.wav]')
    process.exit(2)
  }
  recordMic(seconds, process.argv[3]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
