/** Preload script: exposes IPC bridges to the renderer. */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('voiceAPI', {
  /** Send audio frames to the main process. */
  sendFrames: (buffers: ArrayBuffer[]) => {
    ipcRenderer.send('frames', buffers)
  },
  /** Listen for state updates from the main process. */
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('state', (_event, state) => callback(state))
  },
})
