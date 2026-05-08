// ---------------------------------------------------------------------------
// audioCapture.ts
//
// Push-to-talk audio capture pipeline. Mirrors the role of BuddyDictationManager
// and BuddyAudioConversionSupport in the original Swift app.
//
// Flow:
//   getUserMedia → AudioContext (16kHz mono) → AudioWorklet → PCM16 chunks
//
// The AudioWorklet runs on a dedicated audio thread and posts Float32 sample
// buffers back to the main thread. We convert those to PCM16 (Int16Array) for
// streaming to AssemblyAI over WebSocket.
//
// Usage:
//   const capture = new AudioCapture()
//   await capture.start({ onPcm16Chunk, onAudioLevel, onError })
//   // ... user is talking ...
//   capture.stop()
// ---------------------------------------------------------------------------

// AssemblyAI streaming expects 16kHz mono PCM16
export const AUDIO_SAMPLE_RATE = 16000

// How many samples per chunk we send. 4096 samples at 16kHz ≈ 256ms per chunk.
const WORKLET_BUFFER_SIZE = 4096

export interface AudioCaptureCallbacks {
  // Called with each PCM16 chunk ready to stream to AssemblyAI
  onPcm16Chunk: (pcm16Chunk: Int16Array) => void
  // Called with RMS audio level (0.0–1.0) for waveform visualisation
  onAudioLevel: (level: number) => void
  // Called if mic access is denied or audio setup fails
  onError: (error: Error) => void
}

// ---------------------------------------------------------------------------
// AudioWorklet processor code — runs on the audio rendering thread.
// Collects incoming Float32 samples into a buffer and posts them back in
// fixed-size chunks to avoid overwhelming the main thread with tiny messages.
// ---------------------------------------------------------------------------
const AUDIO_WORKLET_PROCESSOR_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = []
    this._bufferSize = ${WORKLET_BUFFER_SIZE}
  }

  process(inputs) {
    const channelData = inputs[0]?.[0]
    if (!channelData) return true

    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i])
    }

    // Post a fixed-size chunk once the buffer fills up
    while (this._buffer.length >= this._bufferSize) {
      const chunk = new Float32Array(this._buffer.splice(0, this._bufferSize))
      this.port.postMessage(chunk, [chunk.buffer])
    }

    return true // keep the processor alive
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
`

// ---------------------------------------------------------------------------
// AudioCapture class
// ---------------------------------------------------------------------------
export class AudioCapture {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private workletNode: AudioWorkletNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletBlobUrl: string | null = null
  private _isCapturing = false

  get isCapturing(): boolean {
    return this._isCapturing
  }

  // -------------------------------------------------------------------------
  // start — requests mic access, sets up the audio graph, begins streaming
  // -------------------------------------------------------------------------
  async start(callbacks: AudioCaptureCallbacks): Promise<void> {
    if (this._isCapturing) return

    // On macOS, request permission via the main process first
    try {
      const permitted = await window.hotaru.requestMicPermission()
      if (!permitted) {
        callbacks.onError(new Error('Microphone permission was denied.'))
        return
      }
    } catch {
      // Permission API unavailable on this platform — proceed and let
      // getUserMedia handle it natively
    }

    try {
      // Request the microphone stream — this triggers the OS permission prompt
      // on Windows if not already granted
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      // Create an AudioContext at the target sample rate.
      // The browser will resample from the hardware rate if necessary.
      this.audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })

      // Load the worklet processor from a blob URL so we avoid any file path
      // resolution issues in the packaged Electron app
      this.workletBlobUrl = URL.createObjectURL(
        new Blob([AUDIO_WORKLET_PROCESSOR_CODE], { type: 'application/javascript' })
      )
      await this.audioContext.audioWorklet.addModule(this.workletBlobUrl)

      // Build the audio graph: mic → worklet
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-capture-processor')

      // Handle incoming Float32 chunks from the worklet thread
      this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const float32Chunk = event.data
        const pcm16Chunk = convertFloat32ToPcm16(float32Chunk)
        callbacks.onPcm16Chunk(pcm16Chunk)

        const audioLevel = calculateRmsLevel(float32Chunk)
        callbacks.onAudioLevel(audioLevel)
      }

      // Connect the graph. We connect worklet → destination to keep the audio
      // context running, but the destination has no actual speakers output since
      // we're only capturing, not playing back.
      this.sourceNode.connect(this.workletNode)
      this.workletNode.connect(this.audioContext.destination)

      this._isCapturing = true
    } catch (error) {
      this.cleanup()
      callbacks.onError(
        error instanceof Error ? error : new Error('Failed to start microphone capture.')
      )
    }
  }

  // -------------------------------------------------------------------------
  // stop — tears down the audio graph and releases the mic
  // -------------------------------------------------------------------------
  stop(): void {
    if (!this._isCapturing) return
    this._isCapturing = false
    this.cleanup()
  }

  // -------------------------------------------------------------------------
  // cleanup — internal teardown (also called on error)
  // -------------------------------------------------------------------------
  private cleanup(): void {
    this.workletNode?.disconnect()
    this.workletNode = null

    this.sourceNode?.disconnect()
    this.sourceNode = null

    this.mediaStream?.getTracks().forEach((track) => track.stop())
    this.mediaStream = null

    this.audioContext?.close()
    this.audioContext = null

    if (this.workletBlobUrl) {
      URL.revokeObjectURL(this.workletBlobUrl)
      this.workletBlobUrl = null
    }
  }
}

// ---------------------------------------------------------------------------
// convertFloat32ToPcm16
//
// Converts a Float32Array of audio samples (range -1.0 to 1.0) to a PCM16
// Int16Array (range -32768 to 32767). This is what AssemblyAI streaming
// expects over the WebSocket connection.
// ---------------------------------------------------------------------------
export function convertFloat32ToPcm16(float32Samples: Float32Array): Int16Array {
  const pcm16Samples = new Int16Array(float32Samples.length)
  for (let sampleIndex = 0; sampleIndex < float32Samples.length; sampleIndex++) {
    // Clamp the float sample to [-1, 1] to prevent overflow
    const clampedSample = Math.max(-1, Math.min(1, float32Samples[sampleIndex]))
    // Scale to int16 range — negative values map to -32768, positive to 32767
    pcm16Samples[sampleIndex] =
      clampedSample < 0 ? clampedSample * 32768 : clampedSample * 32767
  }
  return pcm16Samples
}

// ---------------------------------------------------------------------------
// calculateRmsLevel
//
// Computes the Root Mean Square of a Float32 audio buffer as a normalised
// 0.0–1.0 value. Used to drive the waveform / audio level indicator in the UI.
// ---------------------------------------------------------------------------
export function calculateRmsLevel(float32Samples: Float32Array): number {
  if (float32Samples.length === 0) return 0

  let sumOfSquares = 0
  for (let i = 0; i < float32Samples.length; i++) {
    sumOfSquares += float32Samples[i] * float32Samples[i]
  }
  const rms = Math.sqrt(sumOfSquares / float32Samples.length)

  // Scale RMS to a 0–1 range. Typical voice RMS is 0.01–0.3 so we multiply
  // by 5 to make the visualisation more responsive, then clamp to 1.
  return Math.min(1, rms * 5)
}
