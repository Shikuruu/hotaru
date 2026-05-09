// ---------------------------------------------------------------------------
// claudeClient.ts
//
// Direct Anthropic API client for the renderer process.
// Mirrors the role of ClaudeProvider.swift in the original macOS app.
//
// Flow per PTT session:
//   1. Receive final transcript from AssemblyAI
//   2. Bundle screenshots as base64 JPEG image blocks
//   3. POST to /v1/messages with stream: true
//   4. Parse SSE content_block_delta events → fire onTextDelta callbacks
//   5. Fire onComplete with the full accumulated response text
//
// The 'anthropic-dangerous-direct-browser-access' header is required when
// calling the API directly from a browser/Electron renderer context (no proxy).
// ---------------------------------------------------------------------------

import { ScreenCapture } from './screenCapture'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// Use the latest available Claude model — update as needed
const MODEL = 'claude-opus-4-5'

// System prompt — describes Hotaru's role and the [POINT] tag syntax used
// by the cursor overlay to highlight UI elements (wired in a later step)
const SYSTEM_PROMPT = `You are Hotaru, an always-on AI desktop companion. \
You can see the user's screen(s) and hear their voice via push-to-talk. \
Be concise, direct, and conversational — this is a voice interface, so prefer \
short responses. Avoid markdown formatting (no bullet lists, no headers). \
When you want to draw attention to something visible on screen, insert a \
[POINT:x:y:label:screenN] tag where x and y are decimal fractions (0–1) of \
that screen's width and height, label is a short description, and screenN is \
the screen name (e.g. "Screen 1"). Only point to things you can actually see.`

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClaudeCallbacks {
  /** Fired for each streamed text chunk — append to the displayed response */
  onTextDelta: (delta: string) => void
  /** Fired once when the stream ends — fullText is the complete response */
  onComplete: (fullText: string) => void
  /** Fired on network error or non-2xx API response */
  onError: (error: Error) => void
}

// ---------------------------------------------------------------------------
// askClaude — main entry point
// ---------------------------------------------------------------------------

export async function askClaude(
  apiKey: string,
  transcript: string,
  screenshots: ScreenCapture[],
  callbacks: ClaudeCallbacks
): Promise<void> {
  // Build the message content: screenshots first, then the spoken question
  const content: unknown[] = []

  for (const screen of screenshots) {
    // Image block
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: screen.base64Jpeg
      }
    })
    // Caption so Claude knows which display this is
    content.push({
      type: 'text',
      text: `[Screen: ${screen.displayName}, ${screen.width}×${screen.height}px]`
    })
  }

  // The spoken transcript
  content.push({ type: 'text', text: transcript })

  const requestBody = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    stream: true
  }

  // -------------------------------------------------------------------------
  // Fetch with SSE streaming
  // -------------------------------------------------------------------------
  let response: Response
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for direct browser / Electron renderer calls (no backend proxy)
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })
  } catch (err) {
    callbacks.onError(
      err instanceof Error ? err : new Error('Network error reaching Claude API')
    )
    return
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '(no body)')
    callbacks.onError(new Error(`Claude API ${response.status}: ${errBody}`))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    callbacks.onError(new Error('Claude API returned no response body'))
    return
  }

  // -------------------------------------------------------------------------
  // Parse SSE — only content_block_delta / text_delta events carry text
  // -------------------------------------------------------------------------
  const decoder = new TextDecoder()
  let fullText = ''
  let sseBuffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      sseBuffer += decoder.decode(value, { stream: true })

      // Split on newlines; keep any incomplete trailing line in the buffer
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === '[DONE]') continue

        let event: Record<string, unknown>
        try {
          event = JSON.parse(payload)
        } catch {
          continue // ignore malformed events
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            fullText += delta.text
            callbacks.onTextDelta(delta.text)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  callbacks.onComplete(fullText)
}
