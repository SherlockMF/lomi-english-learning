export function microphoneLevel(samples: Float32Array): number {
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length))
  return Math.min(1, Math.max(0, (rms - 0.008) * 8))
}

export function pcm16(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const count = Math.floor(samples.length * 16000 / sampleRate)
  const bytes = new Uint8Array(count * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sampleRate / 16000)
    const end = Math.max(start + 1, Math.floor((i + 1) * sampleRate / 16000))
    let value = 0
    for (let j = start; j < Math.min(end, samples.length); j++) value += samples[j]
    value = Math.max(-1, Math.min(1, value / (end - start)))
    view.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true)
  }
  return bytes
}

export function wavBlob(pcm: Uint8Array<ArrayBuffer>, sampleRate: number): Blob {
  const bytes = new Uint8Array(44 + pcm.length)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => [...value].forEach((character, i) => { bytes[offset + i] = character.charCodeAt(0) })
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.length, true)
  bytes.set(pcm, 44)
  return new Blob([bytes], { type: 'audio/wav' })
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
}

export function monitorMicrophone(stream: MediaStream, onLevel: (level: number) => void): () => void {
  if (typeof AudioContext === 'undefined') return () => onLevel(0)
  let context: AudioContext | undefined
  let frame = 0
  let last = 0
  try {
    context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const sample = (now: number) => {
      if (now - last >= 80) {
        analyser.getFloatTimeDomainData(samples)
        onLevel(stream.getAudioTracks().some((track) => track.enabled && track.readyState === 'live') ? microphoneLevel(samples) : 0)
        last = now
      }
      frame = requestAnimationFrame(sample)
    }
    frame = requestAnimationFrame(sample)
    void context.resume().catch(() => undefined)
    return () => { cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); void context?.close().catch(() => undefined); onLevel(0) }
  } catch { void context?.close().catch(() => undefined); return () => onLevel(0) }
}

export function prepareVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') throw new Error('当前浏览器不支持录音，请使用 localhost 或 HTTPS 下的最新版浏览器。')
  const context = new AudioContext({ sampleRate: 16000 })
  const ready = Promise.resolve().then(() => context.audioWorklet.addModule(new URL('./recorder.worklet.js', import.meta.url).href))
  return { context, ready }
}

export class VoiceRecorder {
  private stream?: MediaStream
  private node?: AudioWorkletNode
  private source?: MediaStreamAudioSourceNode
  private sink?: GainNode
  private chunks: Float32Array[] = []
  private size = 0
  private closed = false
  private stopped?: () => void
  constructor(private onLevel: (level: number) => void, private audio: ReturnType<typeof prepareVoiceRecording>) {}

  async start(): Promise<void> {
    const { context, ready } = this.audio
    try {
      const media = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        .then((stream) => {
          if (this.closed) stream.getTracks().forEach((track) => track.stop())
          else this.stream = stream
          return stream
        })
      const [stream] = await Promise.all([media, context.resume(), ready])
      if (this.closed) return
      const node = new AudioWorkletNode(context, 'recall-recorder')
      this.node = node
      // oxlint-disable-next-line prefer-add-event-listener -- One owned handler; onmessage also starts the MessagePort.
      node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
        if (data === 'stopped') { this.stopped?.(); return }
        if (this.closed || !(data instanceof Float32Array)) return
        const chunk = data.slice(0, Math.max(0, 960000 - this.size))
        this.chunks.push(chunk); this.size += chunk.length
        this.onLevel(microphoneLevel(chunk))
      }
      this.source = context.createMediaStreamSource(stream)
      this.sink = context.createGain()
      this.sink.gain.value = 0
      this.source.connect(node); node.connect(this.sink); this.sink.connect(context.destination)
    } catch (error) { this.cancel(); throw error }
  }

  async finish(): Promise<Uint8Array<ArrayBuffer>> {
    if (this.closed || !this.node) { this.cancel(); return new Uint8Array() }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1000)
      this.stopped = () => { clearTimeout(timeout); resolve() }
      // oxlint-disable-next-line require-post-message-target-origin -- MessagePort.postMessage has no targetOrigin argument.
      this.node!.port.postMessage('stop')
    })
    const samples = new Float32Array(this.size)
    let offset = 0
    for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length }
    const pcm = pcm16(samples, this.audio.context.sampleRate)
    this.cancel()
    return pcm
  }

  cancel() {
    if (this.closed) return
    this.closed = true
    this.stopped?.()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.source?.disconnect(); this.node?.disconnect(); this.sink?.disconnect()
    if (this.node) {
      // oxlint-disable-next-line prefer-add-event-listener -- Remove the recorder's single owned port handler on cancellation.
      this.node.port.onmessage = null
      // oxlint-disable-next-line require-post-message-target-origin -- MessagePort.postMessage has no targetOrigin argument.
      if (!this.stopped) this.node.port.postMessage('cancel')
    }
    this.chunks = []; this.size = 0
    this.onLevel(0)
  }
}
