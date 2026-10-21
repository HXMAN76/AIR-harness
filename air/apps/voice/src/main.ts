/** Electron main process: creates the voice window, wires listener + speaker + controller.
 *
 * Paths are computed from `__dirname` (the `lib/` output) so bundling does not shift them.
 */
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { Listener } from './core/listener.ts'
import { Speaker } from './core/speaker.ts'
import { AgentBridge } from './core/agent.ts'
import { VoiceController } from './core/controller.ts'
import { mkdirSync } from 'node:fs'
import { assertWorkspaceOutsideHome, voiceHome, voiceWorkspace } from './core/home.ts'
import { modelRoot } from './core/models.ts'

let mainWindow: BrowserWindow | undefined
let listener: Listener | undefined
let speaker: Speaker | undefined
let agent: AgentBridge | undefined
let controller: VoiceController | undefined

const FRAME_SIZE = 1_600 // 100 ms at 16 kHz

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
  listener.on('command', (command: { text: string; lang: string; decodeMs: number }) => {
    console.log(`heard (${command.lang}, ${command.decodeMs}ms):`, command.text)
  })
  listener.on('language', (info: { lang: string; loadMs: number }) => {
    console.log(`language ${info.lang} (${info.loadMs}ms)`)
  })
  listener.on('ready', (ms: number) => {
    console.log(`listener ready (${ms}ms)`)
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
    onState: (state) => {
      console.log('state:', state.phase, state.transcript ?? '', state.reply ?? '', state.error ?? '')
      mainWindow?.webContents.send('state', state)
    },
  })

  listener.start()
  console.log('voice agent started (listener, speaker, bridge, controller)')
}

function setupIpc(): void {
  ipcMain.on('frames', (_event, buffers: ArrayBuffer[]) => {
    if (!listener) return
    for (const buffer of buffers) {
      const frame = new Float32Array(buffer)
      if (frame.length === FRAME_SIZE) {
        listener.push(frame)
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
  console.log('AIR voice agent starting…')

  // Grant only the media permission (microphone)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  setupIpc()
  createWindow()

  try {
    startVoice()
    console.log('voice agent running')
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
