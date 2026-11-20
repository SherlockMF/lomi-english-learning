class RecallRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.recording = true
    this.buffer = new Float32Array(2048)
    this.offset = 0
    // oxlint-disable-next-line prefer-add-event-listener -- Single worklet-owned handler; assigning it starts the MessagePort.
    this.port.onmessage = ({ data }) => {
      if (data !== 'stop' && data !== 'cancel') return
      this.recording = false
      if (data === 'stop') {
        // oxlint-disable-next-line require-post-message-target-origin -- MessagePort.postMessage has no targetOrigin argument.
        if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset))
        // oxlint-disable-next-line require-post-message-target-origin -- MessagePort.postMessage has no targetOrigin argument.
        this.port.postMessage('stopped')
      }
      this.port.close()
    }
  }
  process(inputs) {
    if (!this.recording) return false
    const input = inputs[0]?.[0]
    if (!input) return true
    for (const sample of input) {
      this.buffer[this.offset++] = sample
      if (this.offset === this.buffer.length) {
        // oxlint-disable-next-line require-post-message-target-origin -- MessagePort.postMessage has no targetOrigin argument.
        this.port.postMessage(this.buffer.slice())
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('recall-recorder', RecallRecorder)
