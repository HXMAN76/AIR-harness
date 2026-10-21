/** AudioWorklet processor: captures microphone frames at 16 kHz mono. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.bufferSize = 1600 // 100ms at 16kHz
    this.buffer = new Float32Array(this.bufferSize)
    this.bufferIndex = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input.length === 0 || input[0].length === 0) return true

    const channelData = input[0]

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i]

      if (this.bufferIndex >= this.bufferSize) {
        // Send the buffer to the main thread
        this.port.postMessage(this.buffer.slice())
        this.bufferIndex = 0
      }
    }

    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
