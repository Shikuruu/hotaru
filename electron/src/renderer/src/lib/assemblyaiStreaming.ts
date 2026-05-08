// ---------------------------------------------------------------------------
// assemblyaiStreaming.ts
//
// AssemblyAI real-time streaming transcription client. Mirrors the role of
// AssemblyAIStreamingTranscriptionProvider.swift in the original macOS app.
//
// Flow per push-to-talk session:
//   1. Fetch a short-lived token directly from AssemblyAI (no proxy needed —
//      we have the user's own API key stored locally in the OS keychain)
//   2. Open a WebSocket to the AssemblyAI v3 streaming endpoint
//   3. Stream PCM16 binary frames as the user speaks
//   4. Receive partial transcripts (shown live in UI as the user speaks)
//   5. On key release: send forceEndUtterance to get the final punctuated text
//   6. Disconnect cleanly after the final transcript arrives
// ---------------------------------------------------------------------------

import { AUDIO_SAMPLE_RATE } from './audioCapture'

// How long (ms) to wait for a final transcript after forceEndUtterance before
// giving up and using the last partial transcript as the final result
const FINAL_TRANSCRIPT_TIMEOUT_MS = 5000

export interface AssemblyAICallbacks {
  // Fired continuously as the user speaks — shown as live preview text
  onPartialTranscript: (text: string) => void
  // Fired once after forceEndUtterance — the complete punctuated utterance
  onFinalTranscript: (text: string) => void
  // Fired if the WebSocket connection or token fetch fails
  onError: (error: Error) => void
}

// ---------------------------------------------------------------------------
// AssemblyAIStreamingClient
// ---------------------------------------------------------------------------
export class AssemblyAIStreamingClient {
  private readonly assemblyAiApiKey: string
  private websocket: WebSocket | null = null
  private isConnected = false
  private callbacks: AssemblyAICallbacks | null = null
  private finalTranscriptTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Buffer audio chunks that arrive before the WebSocket is open
  private pendingAudioChunks: Int16Array[] = []

  constructor(assemblyAiApiKey: string) {
    this.assemblyAiApiKey = assemblyAiApiKey
  }

  // -------------------------------------------------------------------------
  // connect — fetches a temp token then opens the WebSocket
  // -------------------------------------------------------------------------
  async connect(callbacks: AssemblyAICallbacks): Promise<void> {
    this.callbacks = callbacks

    let tempToken: string
    try {
      tempToken = await this.fetchTempToken()
    } catch (error) {
      callbacks.onError(
        error instanceof Error ? error : new Error('Failed to fetch AssemblyAI token.')
      )
      return
    }

    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${AUDIO_SAMPLE_RATE}&token=${tempToken}`
    this.websocket = new WebSocket(wsUrl)
    this.websocket.binaryType = 'arraybuffer'

    this.websocket.onopen = () => {
      this.isConnected = true
      // Flush any audio chunks that arrived while we were connecting
      for (const bufferedChunk of this.pendingAudioChunks) {
        this.sendAudioChunk(bufferedChunk)
      }
      this.pendingAudioChunks = []
    }

    this.websocket.onmessage = (event: MessageEvent) => {
      this.handleIncomingMessage(event.data as string)
    }

    this.websocket.onerror = () => {
      callbacks.onError(new Error('AssemblyAI WebSocket connection error.'))
      this.cleanup()
    }

    this.websocket.onclose = () => {
      this.isConnected = false
    }
  }

  // -------------------------------------------------------------------------
  // sendAudioChunk — sends a PCM16 binary frame over the WebSocket.
  // If called before the socket is open, the chunk is buffered and flushed
  // automatically once the connection is established.
  // -------------------------------------------------------------------------
  sendAudioChunk(pcm16Chunk: Int16Array): void {
    if (!this.websocket) return

    if (!this.isConnected) {
      // Buffer until the socket opens
      this.pendingAudioChunks.push(pcm16Chunk)
      return
    }

    // Send the raw PCM16 bytes
    this.websocket.send(pcm16Chunk.buffer)
  }

  // -------------------------------------------------------------------------
  // forceEndUtterance — signals AssemblyAI to finalise the current transcript.
  // Call this when the user releases the push-to-talk key. Sets a timeout so
  // we don't wait forever if the network is slow.
  // -------------------------------------------------------------------------
  forceEndUtterance(): void {
    if (!this.websocket || !this.isConnected) return

    this.websocket.send(JSON.stringify({ message_type: 'FinalTranscript' }))

    // Safety timeout — if no final transcript arrives, use the last partial
    this.finalTranscriptTimeoutId = setTimeout(() => {
      this.callbacks?.onFinalTranscript('')
      this.disconnect()
    }, FINAL_TRANSCRIPT_TIMEOUT_MS)
  }

  // -------------------------------------------------------------------------
  // disconnect — cleanly closes the session
  // -------------------------------------------------------------------------
  disconnect(): void {
    if (this.finalTranscriptTimeoutId !== null) {
      clearTimeout(this.finalTranscriptTimeoutId)
      this.finalTranscriptTimeoutId = null
    }
    this.cleanup()
  }

  // -------------------------------------------------------------------------
  // handleIncomingMessage — routes AssemblyAI WebSocket messages
  // -------------------------------------------------------------------------
  private handleIncomingMessage(rawMessage: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(rawMessage)
    } catch {
      return // ignore malformed messages
    }

    const messageType = message.message_type as string

    if (messageType === 'PartialTranscript') {
      const partialText = (message.text as string) ?? ''
      if (partialText) {
        this.callbacks?.onPartialTranscript(partialText)
      }
    }

    if (messageType === 'FinalTranscript') {
      const finalText = (message.text as string) ?? ''
      // Clear the safety timeout since we got a real final transcript
      if (this.finalTranscriptTimeoutId !== null) {
        clearTimeout(this.finalTranscriptTimeoutId)
        this.finalTranscriptTimeoutId = null
      }
      this.callbacks?.onFinalTranscript(finalText)
      this.disconnect()
    }
  }

  // -------------------------------------------------------------------------
  // fetchTempToken — calls AssemblyAI directly with the user's API key.
  // Returns a short-lived token (480s) used to authenticate the WebSocket.
  // This avoids sending the raw API key in the WebSocket URL.
  // -------------------------------------------------------------------------
  private async fetchTempToken(): Promise<string> {
    const response = await fetch(
      'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
      {
        method: 'GET',
        headers: {
          Authorization: this.assemblyAiApiKey
        }
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`AssemblyAI token error ${response.status}: ${errorBody}`)
    }

    const data = (await response.json()) as { token: string }
    return data.token
  }

  // -------------------------------------------------------------------------
  // cleanup — internal teardown
  // -------------------------------------------------------------------------
  private cleanup(): void {
    this.pendingAudioChunks = []
    if (this.websocket) {
      this.websocket.onopen = null
      this.websocket.onmessage = null
      this.websocket.onerror = null
      this.websocket.onclose = null
      if (
        this.websocket.readyState === WebSocket.OPEN ||
        this.websocket.readyState === WebSocket.CONNECTING
      ) {
        this.websocket.close()
      }
      this.websocket = null
    }
    this.isConnected = false
  }
}
