// ---------------------------------------------------------------------------
// ttsClient.ts
//
// Text-to-speech abstraction with two backends:
//
//   1. Web Speech API (default) — built into Electron's Chromium, zero cost,
//      zero config, uses whatever voices the OS has installed.
//
//   2. OpenAI TTS (optional) — POST /v1/audio/speech, noticeably more natural,
//      used when the user has provided an OpenAI API key in settings.
//
// [POINT:...] cursor-overlay tags are stripped before speaking — they're
// visual-only annotations not meant to be read aloud.
// ---------------------------------------------------------------------------

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech'

// Default OpenAI voice — "nova" is warm and clear, works well for an assistant.
// Can be extended to a user setting later: alloy | echo | fable | onyx | nova | shimmer
const OPENAI_VOICE = 'nova'
const OPENAI_MODEL = 'tts-1' // tts-1-hd for higher quality at higher cost

// Regex that matches [POINT:x:y:label:screenN] tags in Claude responses
const POINT_TAG_RE = /\[POINT:[^\]]*\]/g

// Track the current audio element so we can stop it on demand
let currentAudio: HTMLAudioElement | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Speak text using the best available backend.
 * Pass `openAiApiKey` to use OpenAI TTS; omit (or pass empty string) to fall
 * back to the Web Speech API.
 */
export async function speak(text: string, openAiApiKey?: string): Promise<void> {
  stopSpeaking()

  const cleanText = stripPointTags(text).trim()
  if (!cleanText) return

  if (openAiApiKey) {
    await speakWithOpenAI(cleanText, openAiApiKey)
  } else {
    await speakWithWebSpeech(cleanText)
  }
}

/**
 * Immediately stop any in-progress speech from either backend.
 */
export function stopSpeaking(): void {
  // Web Speech API
  window.speechSynthesis?.cancel()

  // OpenAI / Audio element
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
}

// ---------------------------------------------------------------------------
// Web Speech API backend
// ---------------------------------------------------------------------------

function speakWithWebSpeech(text: string): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.05   // slightly faster than default — feels more natural
    utterance.pitch = 1
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve() // don't reject — just move on
    window.speechSynthesis.speak(utterance)
  })
}

// ---------------------------------------------------------------------------
// OpenAI TTS backend
// ---------------------------------------------------------------------------

async function speakWithOpenAI(text: string, apiKey: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: text,
        voice: OPENAI_VOICE
      })
    })
  } catch (err) {
    console.error('[Hotaru] OpenAI TTS network error:', err)
    // Fall back to Web Speech API rather than going silent
    return speakWithWebSpeech(text)
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    console.error(`[Hotaru] OpenAI TTS ${response.status}: ${errBody}`)
    return speakWithWebSpeech(text)
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)

  await new Promise<void>((resolve) => {
    const audio = new Audio(url)
    currentAudio = audio

    audio.onended = () => {
      URL.revokeObjectURL(url)
      currentAudio = null
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      currentAudio = null
      resolve()
    }

    audio.play().catch(() => {
      // Autoplay may be blocked — resolve silently
      URL.revokeObjectURL(url)
      currentAudio = null
      resolve()
    })
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripPointTags(text: string): string {
  return text.replace(POINT_TAG_RE, '')
}
