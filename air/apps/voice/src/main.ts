/** Electron main process: creates the voice window, wires listener + speaker + controller.
 *
 * Paths are computed from `__dirname` (the `lib/` output) so bundling does not shift them.
 */
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { Listener } from './core/listener.ts'
import { Speaker } from './core/speaker.ts'
import { AgentBridge } from './core/agent.ts'
import { VoiceController, followUpMsFromEnv } from './core/controller.ts'
import { mkdirSync } from 'node:fs'
import { assertWorkspaceOutsideHome, voiceHome, voiceWorkspace } from './core/home.ts'
import { modelRoot } from './core/models.ts'

let mainWindow: BrowserWindow | undefined
let listener: Listener | undefined
let speaker: Speaker | undefined
let agent: AgentBridge | undefined
let controller: VoiceController | undefined

const FRAME_SIZE = 1_600 // 100 ms at 16 kHz

/** Extra console output (state changes with transcripts and replies, model load times); off unless `AIR_VOICE_DEBUG=1`. */
const DEBUG = process.env.AIR_VOICE_DEBUG === '1'

function debug(...args: unknown[]): void {
  if (DEBUG) console.log(...args)
}

/** Repository root — four levels up from `lib/` (`air/apps/voice/lib` → worktree root). */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
/** Voice app root — one level up from `lib/`. */
const VOICE_APP = join(__dirname, '..')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 520,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  void mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
}

function startVoice(): void {
  const home = voiceHome()
  const workspace = voiceWorkspace()
  assertWorkspaceOutsideHome(workspace, home)
  mkdirSync(workspace, { recursive: true })

  const models = modelRoot()
  const sherpaFrom = join(REPO_ROOT, 'packages', 'experimental', 'speech-to-text-sensevoice', 'package.json')

  listener = new Listener({
    command: 'node',
    args: [join(__dirname, 'listener-worker.cjs'), models, sherpaFrom, join(__dirname, 'keywords.txt')],
  })
  listener.on('error', (err: Error) => {
    console.error('listener error:', err.message)
  })
  listener.on('wake', () => {
    console.log('wake')
  })
  // Text wake: speech that did not start with a wake phrase. Its text is never kept; only this marker is logged.
  listener.on('heard', () => {
    debug('heard (no wake)')
  })
  listener.on('command', (command: { text: string; lang: string; decodeMs: number }) => {
    console.log(`command (${command.lang}):`, command.text)
    debug(`decoded in ${command.decodeMs}ms`)
  })
  listener.on('language', (info: { lang: string; loadMs: number }) => {
    debug(`language ${info.lang} (${info.loadMs}ms)`)
  })
  listener.on('ready', (ms: number) => {
    debug(`listener ready (${ms}ms)`)
  })

  speaker = new Speaker(undefined, join(__dirname, 'speaker.ps1'))
  speaker.warm()

  agent = new AgentBridge({
    dshHome: home,
    cwd: workspace,
    dshBin: join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js'),
    profileDir: join(VOICE_APP, 'profile'),
  })

  controller = new VoiceController({
    listener,
    speaker,
    agent,
    followUpMs: followUpMsFromEnv(process.env),
    onState: (state) => {
      debug('state:', state.phase, state.transcript ?? '', state.reply ?? '', state.error ?? '')
      mainWindow?.webContents.send('state', state)
    },
  })

  listener.start()
  debug('voice agent started (listener, speaker, bridge, controller)')
}

/** Debug-only microphone level: peak and RMS over each 2 s, so a silent or clipping input is visible. */
let meterPeak = 0
let meterSquares = 0
let meterSamples = 0
let meterAt = Date.now()
function meterFrame(frame: Float32Array): void {
  if (process.env['AIR_VOICE_DEBUG'] !== '1') return
  for (const sample of frame) {
    meterPeak = Math.max(meterPeak, Math.abs(sample))
    meterSquares += sample * sample
  }
  meterSamples += frame.length
  if (Date.now() - meterAt < 2_000) return
  debug(`mic peak ${meterPeak.toFixed(3)} rms ${Math.sqrt(meterSquares / meterSamples).toFixed(4)}`)
  meterPeak = 0
  meterSquares = 0
  meterSamples = 0
  meterAt = Date.now()
}

function setupIpc(): void {
  ipcMain.on('frames', (_event, buffers: ArrayBuffer[]) => {
    if (!listener) return
    for (const buffer of buffers) {
      const frame = new Float32Array(buffer)
      if (frame.length === FRAME_SIZE) {
        listener.push(frame)
        meterFrame(frame)
      }
    }
  })

  ipcMain.on('setRoute', (_event, route: unknown) => {
    if (route !== 'local' && route !== 'cloud' && route !== 'screen') return
    void controller?.setRoute(route)
  })

  ipcMain.on('setMemoryShare', (_event, on: boolean) => {
    void controller?.setMemoryShare(on)
  })
}

void app.whenReady().then(() => {
  // Grant only the media permission (microphone)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  setupIpc()
  createWindow()

  try {
    startVoice()
  } catch (err) {
    console.error('voice agent failed to start:', err)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void listener?.stop()
  void speaker?.dispose()
  void agent?.dispose()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
