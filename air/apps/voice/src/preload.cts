/** Preload script: exposes IPC bridges to the renderer. */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voiceAPI', {
  /** Send audio frames to the main process. */
  sendFrames: (buffers: ArrayBuffer[]) => {
    ipcRenderer.send('frames', buffers)
  },
  /** Listen for state updates from the main process. */
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('state', (_event: Electron.IpcRendererEvent, state: unknown) => callback(state))
  },
  /** Request a route change (local | cloud | screen). */
  setRoute: (route: string) => {
    ipcRenderer.send('setRoute', route)
  },
  /** Request a memory-share toggle change. */
  setMemoryShare: (on: boolean) => {
    ipcRenderer.send('setMemoryShare', on)
  },
})
