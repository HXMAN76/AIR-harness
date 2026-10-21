/** Preload script: exposes IPC bridges to the renderer. */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voiceAPI', {
  /** Send audio frames to the main process. */
  sendFrames: (buffers) => {
    ipcRenderer.send('frames', buffers)
  },
  /** Listen for state updates from the main process. */
  onState: (callback) => {
    ipcRenderer.on('state', (_event, state) => callback(state))
  },
  /** Request a route change (local | cloud | screen). */
  setRoute: (route) => {
    ipcRenderer.send('setRoute', route)
  },
  /** Request a memory-share toggle change. */
  setMemoryShare: (on) => {
    ipcRenderer.send('setMemoryShare', on)
  },
})
