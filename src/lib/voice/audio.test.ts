import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { pcm16, wavBlob, microphoneLevel, VoiceRecorder, monitorMicrophone, prepareVoiceRecording } from './audio'
import recorderWorklet from './recorder.worklet.js?raw'

afterEach(() => vi.unstubAllGlobals())

describe('voice audio', () => {
  it('resamples and clips PCM to signed little endian 16 kHz', () => {
    const bytes = pcm16(new Float32Array([1, 1, -2, -2]), 32000)
    const view = new DataView(bytes.buffer)
    expect(bytes.length).toBe(4)
    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
  })
  it('builds a replayable WAV header with the actual sample rate', async () => {
    const blob = wavBlob(new Uint8Array([0, 0, 1, 0]), 24000)
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blob)
    })
    const bytes = new Uint8Array(buffer)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(24000)
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(4)
  })
  it('reports silence as zero and increases with recorded amplitude', () => {
    expect(microphoneLevel(new Float32Array(20))).toBe(0)
    expect(microphoneLevel(new Float32Array(20).fill(0.1))).toBeGreaterThan(0.2)
    expect(microphoneLevel(new Float32Array(20).fill(1))).toBe(1)
  })
  it('stops a microphone that arrives after recording was cancelled', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('AudioContext', class {
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
      resume = vi.fn().mockResolvedValue(undefined)
      close = close
    })
    let grant: (value: MediaStream) => void = () => undefined
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = prepareVoiceRecording()
    const recorder = new VoiceRecorder(vi.fn(), audio)
    const started = recorder.start()
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    recorder.cancel()
    const stop = vi.fn()
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await started
    expect(stop).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    await audio.context.close()
  })
  it('requests the microphone immediately while the audio context is resuming', async () => {
    let resume!: () => void
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('AudioContext', class {
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
      resume = () => new Promise<void>((resolve) => { resume = resolve })
      close = close
    })
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = prepareVoiceRecording()
    const recorder = new VoiceRecorder(vi.fn(), audio)
    const started = recorder.start()
    try {
      expect(getUserMedia).toHaveBeenCalledOnce()
    } finally {
      recorder.cancel()
      resume()
      await started
      await audio.context.close()
    }
    expect(stop).toHaveBeenCalledOnce()
  })
  it('reuses the prepared worklet across recordings and releases each microphone after flushing PCM', async () => {
    const stop = vi.fn(), close = vi.fn().mockResolvedValue(undefined), disconnect = vi.fn()
    const addModule = vi.fn().mockResolvedValue(undefined)
    const stream = { getTracks: () => [{ stop }] }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    const message = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const connection = { connect: vi.fn(), disconnect }
    vi.stubGlobal('AudioContext', class {
      sampleRate = 16000; destination = {}; audioWorklet = { addModule }
      resume = vi.fn().mockResolvedValue(undefined); close = close
      createMediaStreamSource = () => connection
      createGain = () => ({ ...connection, gain: { value: 1 } })
    })
    vi.stubGlobal('AudioWorkletNode', class {
      connect = vi.fn(); disconnect = disconnect
      port = { onmessage: null as ((event: { data: Float32Array | string }) => void) | null, postMessage: (command: string) => {
        message(command)
        if (command !== 'stop') return
        this.port.onmessage?.({ data: new Float32Array(16000).fill(.1) })
        this.port.onmessage?.({ data: 'stopped' })
      } }
    })
    const audio = prepareVoiceRecording()
    await audio.ready
    expect(addModule).toHaveBeenCalledOnce()
    expect(getUserMedia).not.toHaveBeenCalled()
    const first = new VoiceRecorder(vi.fn(), audio)
    await first.start()
    expect((await first.finish()).length).toBe(32000)
    const second = new VoiceRecorder(vi.fn(), audio)
    await second.start()
    second.cancel()
    expect(message).toHaveBeenLastCalledWith('cancel')
    expect(addModule).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(disconnect).toHaveBeenCalledTimes(6)
    expect(close).not.toHaveBeenCalled()
    await audio.context.close()
  })
  it.each(['stop', 'cancel'])('terminates the worklet on %s and only flushes audio on stop', (command) => {
    const port = { close: vi.fn(), postMessage: vi.fn(), onmessage: (_event: { data: string }) => undefined }
    let processor!: { process: (inputs: Float32Array[][]) => boolean }
    runInNewContext(recorderWorklet, {
      AudioWorkletProcessor: class { port = port },
      registerProcessor: (_name: string, Processor: new () => typeof processor) => { processor = new Processor() },
    })
    expect(processor.process([[new Float32Array([0.5])]])).toBe(true)
    port.onmessage({ data: command })
    expect(processor.process([])).toBe(false)
    expect(port.close).toHaveBeenCalledOnce()
    if (command === 'stop') {
      expect(Array.from(port.postMessage.mock.calls[0][0])).toEqual([0.5])
      expect(port.postMessage).toHaveBeenLastCalledWith('stopped')
    } else expect(port.postMessage).not.toHaveBeenCalled()
  })
  it('meters only a live enabled track and cancels its animation on cleanup', () => {
    const track = { enabled: true, readyState: 'live' }, close = vi.fn().mockResolvedValue(undefined)
    let frame: FrameRequestCallback = () => undefined
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1 }))
    const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel)
    vi.stubGlobal('AudioContext', class {
      resume = vi.fn().mockResolvedValue(undefined); close = close
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
      createAnalyser = () => ({ fftSize: 512, getFloatTimeDomainData: (values: Float32Array) => values.fill(.1), disconnect: vi.fn() })
    })
    const level = vi.fn()
    const cleanup = monitorMicrophone({ getAudioTracks: () => [track] } as unknown as MediaStream, level)
    frame(100); expect(level.mock.calls.at(-1)?.[0]).toBeGreaterThan(.2)
    track.enabled = false; frame(200); expect(level).toHaveBeenLastCalledWith(0)
    cleanup(); expect(close).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledWith(1)
  })
})
