/** Renderer script: captures audio, updates UI from state. */

// @ts-check

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
 */

/** @type {HTMLDivElement} */
const statusDot = document.getElementById('statusDot')
/** @type {HTMLDivElement} */
const phaseLabel = document.getElementById('phaseLabel')
/** @type {HTMLDivElement} */
const micIndicator = document.getElementById('micIndicator')
/** @type {HTMLDivElement} */
const transcriptEl = document.getElementById('transcript')
/** @type {HTMLDivElement} */
const replyEl = document.getElementById('reply')
/** @type {HTMLDivElement} */
const toolsEl = document.getElementById('tools')
/** @type {HTMLInputElement} */
const memoryShareCheckbox = document.getElementById('memoryShare')
/** @type {NodeListOf<HTMLButtonElement>} */
const routeButtons = document.querySelectorAll('.route-btn')

let audioContext = null
let workletNode = null

/**
 * Initialize audio capture with echo cancellation and noise suppression.
 */
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      }
    })

    audioContext = new AudioContext({ sampleRate: 16000 })
    await audioContext.audioWorklet.addModule('capture-worklet.js')

    const source = audioContext.createMediaStreamSource(stream)
    workletNode = new AudioWorkletNode(audioContext, 'capture-processor')

    workletNode.port.onmessage = (event) => {
      const buffer = event.data
      if (window.voiceAPI) {
        window.voiceAPI.sendFrames([buffer])
      }
    }

    source.connect(workletNode)
    micIndicator.classList.add('active')
  } catch (err) {
    console.error('Failed to initialize audio:', err)
    micIndicator.classList.remove('active')
  }
}

/**
 * Update the UI from a state change.
 * @param {VoiceState} state
 */
function updateUI(state) {
  // Update status dot
  statusDot.className = 'status-dot'
  if (state.phase !== 'idle') {
    statusDot.classList.add(state.phase)
  }

  // Update phase label
  phaseLabel.textContent = state.phase

  // Update transcript
  if (state.transcript) {
    transcriptEl.textContent = state.transcript
  }

  // Update reply
  if (state.reply) {
    replyEl.textContent = state.reply
  } else if (state.error) {
    replyEl.textContent = state.error
    replyEl.classList.add('error')
  }

  // Update tools
  toolsEl.innerHTML = ''
  if (state.tools && state.tools.length > 0) {
    for (const tool of state.tools) {
      const tag = document.createElement('span')
      tag.className = 'tool-tag'
      tag.textContent = tool
      toolsEl.appendChild(tag)
    }
  }

  // Update route buttons
  routeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === state.route)
  })

  // Update memory share checkbox
  memoryShareCheckbox.checked = state.memoryShared
}

// Listen for state updates
if (window.voiceAPI) {
  window.voiceAPI.onState(updateUI)
}

// Wire route button clicks
routeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const route = btn.dataset.route
    if (route && window.voiceAPI && window.voiceAPI.setRoute) {
      window.voiceAPI.setRoute(route)
    }
  })
})

// Wire memory share checkbox clicks
memoryShareCheckbox.addEventListener('change', () => {
  if (window.voiceAPI && window.voiceAPI.setMemoryShare) {
    window.voiceAPI.setMemoryShare(memoryShareCheckbox.checked)
  }
})

// Start audio capture
initAudio()
