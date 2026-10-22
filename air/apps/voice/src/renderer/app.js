/** Renderer script: microphone capture, speech playback, the orb, and the small settings panel. */

/** @typedef {'idle' | 'awake' | 'thinking' | 'speaking'} Phase */
/** @typedef {'local' | 'cloud' | 'screen'} Route */

/**
 * @typedef {Object} VoiceState
 * @property {Phase} phase
 * @property {Route} route
 * @property {string} [transcript]
 * @property {string} [reply]
 * @property {string[]} [tools]
 * @property {string} [error]
 * @property {boolean} memoryShared
 * @property {string} [lang]
 */

const $ = (id) => document.getElementById(id)
const canvas = $('orb')
const lineEl = $('line')
const pillEl = $('pill')
const gearEl = $('gear')
const panelEl = $('panel')
const metaEl = $('meta')
const memoryShareCheckbox = $('memoryShare')
const routeButtons = document.querySelectorAll('.route')
const api = window.voiceAPI
const query = new URLSearchParams(location.search)
const PREVIEW = query.has('preview')
const PHASE_TO_ORB = { idle: 'idle', awake: 'listening', thinking: 'thinking', speaking: 'speaking' }
const ROUTE_LABEL = { local: 'Local', cloud: 'Cloud', screen: 'Screen' }
const LINE_MS = 4000

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const orb = window.createOrb(canvas, { reducedMotion: reducedMotion.matches, forceFallback: query.has('fallback') })
reducedMotion.addEventListener('change', () => location.reload())

// ---------------------------------------------------------------- speech playback

/** Plays WAVs from the main process one after another through an analyser the orb reads. */
const playback = (() => {
  /** @type {AudioContext | undefined} */
  let ctx
  /** @type {AnalyserNode | undefined} */
  let analyser
  let time = new Uint8Array(0)
  let freq = new Uint8Array(0)
  /** @type {{ id: number, wav: string }[]} */
  let queue = []
  /** @type {AudioBufferSourceNode | undefined} */
  let current
  let playing = false
  let epoch = 0

  function ensure() {
    if (ctx === undefined) {
      ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.35
      analyser.connect(ctx.destination)
      time = new Uint8Array(analyser.fftSize)
      freq = new Uint8Array(analyser.frequencyBinCount)
    }
    return ctx
  }

  function bytes(base64) {
    const bin = atob(base64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out.buffer
  }

  async function next() {
    if (playing) return
    const item = queue.shift()
    if (item === undefined) return
    playing = true
    const mine = epoch
    try {
      const audio = ensure()
      if (audio.state === 'suspended') await audio.resume()
      const buffer = await audio.decodeAudioData(bytes(item.wav))
      if (mine !== epoch) return
      await new Promise((resolve) => {
        const source = audio.createBufferSource()
        source.buffer = buffer
        source.connect(analyser)
        source.onended = resolve
        current = source
        source.start()
      })
    } catch (error) {
      console.error('speech playback failed:', error)
    }
    if (mine !== epoch) return
    current = undefined
    api?.played(item.id)
    playing = false
    void next()
  }

  return {
    play(id, wav) {
      queue.push({ id, wav })
      void next()
    },
    /** Stop now: drop the queue and cut the running sound. */
    stop() {
      epoch++
      queue = []
      const source = current
      current = undefined
      playing = false
      if (source !== undefined) {
        source.onended = null
        try { source.stop() } catch { /* already stopped */ }
      }
    },
    /** A short wake cue, generated here so all sound comes from one place. */
    beep() {
      const audio = ensure()
      const rate = audio.sampleRate
      const length = Math.round(rate * 0.12)
      const buffer = audio.createBuffer(1, length, rate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) {
        const t = i / rate
        const envelope = Math.min(1, t / 0.006) * Math.min(1, (0.12 - t) / 0.03)
        data[i] = Math.sin(2 * Math.PI * 880 * t) * 0.22 * envelope
      }
      const source = audio.createBufferSource()
      source.buffer = buffer
      source.connect(audio.destination)
      source.start()
    },
    /** Level (0..1) and high-band energy (0..1) of what is sounding now. */
    sample() {
      if (analyser === undefined || current === undefined) return { level: 0, high: 0 }
      analyser.getByteTimeDomainData(time)
      let sum = 0
      for (const v of time) {
        const x = (v - 128) / 128
        sum += x * x
      }
      const rms = Math.sqrt(sum / time.length)
      analyser.getByteFrequencyData(freq)
      const from = Math.floor(freq.length * 0.3)
      let energy = 0
      for (let i = from; i < freq.length; i++) energy += freq[i]
      const high = energy / ((freq.length - from) * 255)
      return { level: Math.min(1, Math.sqrt(rms) * 1.7), high: Math.min(1, high * 3.2) }
    },
  }
})()

api?.onPlay((id, wav) => playback.play(id, wav))
api?.onStopAudio(() => playback.stop())
api?.onBeep(() => playback.beep())

// ---------------------------------------------------------------- microphone

let micLevel = 0

async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    })
    const audioContext = new AudioContext({ sampleRate: 16000 })
    await audioContext.audioWorklet.addModule('capture-worklet.js')
    const source = audioContext.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioContext, 'capture-processor')
    workletNode.port.onmessage = (event) => {
      if (typeof event.data === 'number') micLevel = Math.min(1, Math.max(0, (event.data - 0.02) * 6))
      else api?.sendFrames([event.data])
    }
    source.connect(workletNode)
  } catch (err) {
    console.error('Failed to initialize audio:', err)
  }
}

// ---------------------------------------------------------------- orb input

let phase = 'idle'
const previewStart = performance.now()

function tick() {
  let level = 0
  let high = 0
  if (phase === 'speaking') {
    const s = playback.sample()
    level = s.level
    high = s.high
  } else if (phase === 'awake') {
    if (PREVIEW) {
      const t = (performance.now() - previewStart) / 1000
      level = Math.max(0, 0.45 + 0.3 * Math.sin(t * 5.1) + 0.2 * Math.sin(t * 11.3 + 1))
    } else level = micLevel
  }
  orb.setInput(level, high)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

document.addEventListener('visibilitychange', () => orb.setPaused(document.hidden))

// ---------------------------------------------------------------- text line, pill, panel

let lineTimer
function showLine(text, kind) {
  if (!text) return
  clearTimeout(lineTimer)
  lineEl.textContent = text
  lineEl.className = `line ${kind} show`
  lineTimer = setTimeout(() => lineEl.classList.remove('show'), LINE_MS)
}

let last = { phase: 'idle', transcript: undefined, reply: undefined, error: undefined }

/** @param {VoiceState} state */
function updateUI(state) {
  phase = state.phase
  orb.setState(PHASE_TO_ORB[state.phase] ?? 'idle')
  if (state.error && state.error !== last.error) showLine(state.error, 'error')
  else if (state.progress && state.phase === 'thinking') showLine(state.progress, 'progress')
  else if (state.reply && (state.reply !== last.reply || (state.phase === 'speaking' && last.phase !== 'speaking'))) showLine(state.reply, 'reply')
  else if (state.transcript && state.phase === 'thinking' && last.phase !== 'thinking') showLine(state.transcript, 'heard')
  last = { phase: state.phase, transcript: state.transcript, reply: state.reply, error: state.error }

  pillEl.textContent = ROUTE_LABEL[state.route] ?? state.route
  routeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.route === state.route))
  memoryShareCheckbox.checked = state.memoryShared
  const tools = state.tools && state.tools.length > 0 ? `Tools: ${state.tools.join(', ')}` : ''
  metaEl.textContent = [state.lang === 'ta' ? 'Tamil' : 'English', tools].filter(Boolean).join('  ·  ')
}

const openAirEl = $('openAir')
function updateOpenAir(state) {
  openAirEl.hidden = !state.sessionId
}
api?.onState(updateOpenAir)
openAirEl.addEventListener('click', () => api?.openInAir())

api?.onState(updateUI)

gearEl.addEventListener('click', () => {
  const open = panelEl.hidden
  panelEl.hidden = !open
  gearEl.setAttribute('aria-expanded', String(open))
})
$('close').addEventListener('click', () => api?.closeWindow())
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !panelEl.hidden) gearEl.click()
})
routeButtons.forEach((btn) => btn.addEventListener('click', () => api?.setRoute(btn.dataset.route)))
memoryShareCheckbox.addEventListener('change', () => api?.setMemoryShare(memoryShareCheckbox.checked))

// ---------------------------------------------------------------- start

if (PREVIEW) {
  window.__orb = { stats: () => orb.takeStats(), kind: orb.kind, openPanel: () => { if (panelEl.hidden) gearEl.click() } }
} else void initAudio()
orb.start()
