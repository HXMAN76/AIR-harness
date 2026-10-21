/** Electron main process: creates the voice window, wires listener + speaker + controller. */
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { Listener } from './core/listener.ts'
import { Speaker } from './core/speaker.ts'
import { AgentBridge } from './core/agent.ts'
import { VoiceController } from './core/controller.ts'
import { voiceHome } from './core/home.ts'

let mainWindow: BrowserWindow | undefined
let listener: Listener | undefined
let speaker: Speaker | undefined
let agent: AgentBridge | undefined

const FRAME_SIZE = 1_600 // 100 ms at 16 kHz

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
    },
  })

  void mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
}

function startVoice(): void {
  const home = voiceHome()
  listener = new Listener()
  speaker = new Speaker()
  agent = new AgentBridge({ dshHome: home, cwd: home })
  new VoiceController({
    listener,
    speaker,
    agent,
    onState: (state) => {
      mainWindow?.webContents.send('state', state)
    },
  })

  listener.start()
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
}

void app.whenReady().then(() => {
  // Grant only the media permission (microphone)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  setupIpc()
  createWindow()
  startVoice()
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
