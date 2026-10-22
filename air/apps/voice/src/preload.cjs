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
  /** Speech to play: a base64 WAV with an id to report back. */
  onPlay: (callback) => {
    ipcRenderer.on('play', (_event, id, wav) => callback(id, wav))
  },
  /** Stop all speech now (barge-in). */
  onStopAudio: (callback) => {
    ipcRenderer.on('stopAudio', () => callback())
  },
  /** Play the wake cue. */
  onBeep: (callback) => {
    ipcRenderer.on('beep', () => callback())
  },
  /** Tell the main process an utterance finished playing. */
  played: (id) => {
    ipcRenderer.send('played', id)
  },
  /** Request a route change (local | cloud | screen). */
  setRoute: (route) => {
    ipcRenderer.send('setRoute', route)
  },
  /** Request a memory-share toggle change. */
  setMemoryShare: (on) => {
    ipcRenderer.send('setMemoryShare', on)
  },
  /** Open the voice sessions in the dsh Web UI ("Open in AIR"). */
  openInAir: () => {
    ipcRenderer.send('openInAir')
  },
  /** Close the window. */
  closeWindow: () => {
    ipcRenderer.send('closeWindow')
  },
})
