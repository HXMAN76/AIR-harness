/** AudioWorklet processor: captures microphone frames at 16 kHz mono and reports a running level. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.bufferSize = 1600 // 100ms at 16kHz
    this.buffer = new Float32Array(this.bufferSize)
    this.bufferIndex = 0
    this.squares = 0
    this.counted = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input.length === 0 || input[0].length === 0) return true

    const channelData = input[0]

    for (let i = 0; i < channelData.length; i++) {
      const sample = channelData[i]
      this.squares += sample * sample
      this.counted++
      this.buffer[this.bufferIndex++] = sample

      if (this.bufferIndex >= this.bufferSize) {
        // Send the buffer to the main thread
        this.port.postMessage(this.buffer.slice())
        this.bufferIndex = 0
      }
    }

    if (this.counted >= 512) {
      // RMS of the last ~32 ms, as a plain number, for the orb.
      this.port.postMessage(Math.sqrt(this.squares / this.counted))
      this.squares = 0
      this.counted = 0
    }

    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
