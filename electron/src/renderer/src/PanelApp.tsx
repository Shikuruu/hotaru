import { useState, useEffect, useRef } from 'react'
import SettingsScreen from './SettingsScreen'
import { areSettingsComplete, loadSettings } from './lib/settingsStore'
import { captureAllScreens, ScreenCapture } from './lib/screenCapture'
import { askClaude } from './lib/claudeClient'
import { speak, stopSpeaking } from './lib/ttsClient'

// Web Speech API — webkit-prefixed in Electron/Chromium
const SpeechRecognitionAPI: typeof SpeechRecognition =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

// ---------------------------------------------------------------------------
// Parse [POINT:x:y:label:screenN] tags out of a Claude response
// ---------------------------------------------------------------------------
function parsePointTags(text: string): OverlayPoint[] {
  const points: OverlayPoint[] = []
  const re = /\[POINT:([0-9.]+):([0-9.]+):([^:[\]]+):([^\]]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const x = parseFloat(m[1]), y = parseFloat(m[2])
    if (!isNaN(x) && !isNaN(y)) points.push({ x, y, label: m[3].trim(), screen: m[4].trim() })
  }
  return points
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'responding' | 'speaking'
type AppScreen  = 'loading' | 'settings' | 'main'

// ---------------------------------------------------------------------------
// PanelApp
// ---------------------------------------------------------------------------
export default function PanelApp(): JSX.Element {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('loading')
  const [voiceState, setVoiceState]       = useState<VoiceState>('idle')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [claudeResponse, setClaudeResponse] = useState('')
  const [micError, setMicError]             = useState<string | null>(null)

  // Stable refs
  const recognitionRef       = useRef<SpeechRecognition | null>(null)
  const finalTranscriptRef   = useRef('')
  const anthropicApiKeyRef   = useRef('')
  const openAiApiKeyRef      = useRef('')
  const pendingScreenshotsRef = useRef<ScreenCapture[]>([])

  // Load keys on mount
  useEffect(() => {
    async function init(): Promise<void> {
      const complete = await areSettingsComplete()
      if (!complete) { setCurrentScreen('settings'); return }
      const s = await loadSettings()
      anthropicApiKeyRef.current = s.anthropicApiKey ?? ''
      openAiApiKeyRef.current    = s.openAiApiKey    ?? ''
      setCurrentScreen('main')
    }
    init()
  }, [])

  async function handleSettingsSaved(): Promise<void> {
    const s = await loadSettings()
    anthropicApiKeyRef.current = s.anthropicApiKey ?? ''
    openAiApiKeyRef.current    = s.openAiApiKey    ?? ''
    setCurrentScreen('main')
  }

  // PTT listeners
  useEffect(() => {
    window.hotaru.onPushToTalkStart(async () => {
      stopSpeaking()
      window.hotaru.sendOverlayPoints([])
      setMicError(null)
      setLiveTranscript('')
      setClaudeResponse('')
      finalTranscriptRef.current = ''
      setVoiceState('listening')

      // macOS: pre-request mic permission so the system dialog appears before
      // Web Speech API tries to use it (no-op on Windows)
      await window.hotaru.requestMicPermission()

      if (!SpeechRecognitionAPI) {
        setMicError('Speech recognition is not available.')
        setVoiceState('idle')
        return
      }

      const recognition = new SpeechRecognitionAPI()
      recognitionRef.current = recognition
      recognition.continuous     = true   // keep listening while key is held
      recognition.interimResults = true
      recognition.lang           = 'en-US'

      recognition.onresult = (event) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript
          if (event.results[i].isFinal) finalTranscriptRef.current += chunk
          else interim += chunk
        }
        setLiveTranscript(finalTranscriptRef.current + interim)
      }

      recognition.onerror = (event) => {
        // 'aborted' is expected when we call stop() ourselves
        if (event.error === 'aborted' || event.error === 'no-speech') return
        setMicError(`Speech recognition error: ${event.error}`)
        setVoiceState('idle')
      }

      recognition.onend = () => {
        const transcript = finalTranscriptRef.current.trim()
        if (!transcript) { setVoiceState('idle'); return }

        setLiveTranscript(transcript)
        setVoiceState('processing')
        setClaudeResponse('')

        setVoiceState('responding')
        askClaude(
          anthropicApiKeyRef.current,
          transcript,
          pendingScreenshotsRef.current,
          {
            onTextDelta: (delta) => setClaudeResponse((prev) => prev + delta),
            onComplete: (fullText) => {
              const points = parsePointTags(fullText)
              if (points.length > 0) window.hotaru.sendOverlayPoints(points)

              setVoiceState('speaking')
              speak(fullText, openAiApiKeyRef.current || undefined).finally(() =>
                setVoiceState('idle')
              )
            },
            onError: (err) => {
              setMicError(`Claude error: ${err.message}`)
              setVoiceState('idle')
            }
          }
        )
      }

      recognition.start()
    })

    window.hotaru.onPushToTalkStop(() => {
      // Capture screenshots while recognition finalises — runs in parallel
      pendingScreenshotsRef.current = []
      captureAllScreens()
        .then((screens) => {
          pendingScreenshotsRef.current = screens
          console.log(`[Hotaru] Captured ${screens.length} screen(s)`)
        })
        .catch((err) => console.warn('[Hotaru] Screenshot capture failed:', err))

      recognitionRef.current?.stop()
    })

    return () => {
      stopSpeaking()
      recognitionRef.current?.abort()
      window.hotaru.removeAllListeners('push-to-talk-start')
      window.hotaru.removeAllListeners('push-to-talk-stop')
    }
  }, [])

  if (currentScreen === 'loading') return <LoadingScreen />
  if (currentScreen === 'settings') {
    return (
      <SettingsScreen
        isFirstTimeSetup
        onSettingsSaved={handleSettingsSaved}
      />
    )
  }
  return (
    <MainScreen
      voiceState={voiceState}
      liveTranscript={liveTranscript}
      claudeResponse={claudeResponse}
      micError={micError}
      onOpenSettings={() => setCurrentScreen('settings')}
    />
  )
}

// ---------------------------------------------------------------------------
// LoadingScreen
// ---------------------------------------------------------------------------
function LoadingScreen(): JSX.Element {
  return (
    <div style={{ ...sharedStyles.container, alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 24 }}>🔥</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MainScreen
// ---------------------------------------------------------------------------
interface MainScreenProps {
  voiceState: VoiceState
  liveTranscript: string
  claudeResponse: string
  micError: string | null
  onOpenSettings: () => void
}

function MainScreen({ voiceState, liveTranscript, claudeResponse, micError, onOpenSettings }: MainScreenProps): JSX.Element {
  const statusLabel: Record<VoiceState, string> = {
    idle: 'Ready', listening: 'Listening…', processing: 'Thinking…',
    responding: 'Responding…', speaking: 'Speaking…'
  }

  return (
    <div style={sharedStyles.container}>
      {/* Header */}
      <div style={sharedStyles.header}>
        <span style={{ fontSize: 20 }}>🔥</span>
        <span style={sharedStyles.title}>Hotaru</span>
        <span style={styles.statusBadge(voiceState)}>{statusLabel[voiceState]}</span>
        <button style={styles.settingsButton} onClick={onOpenSettings} title="Settings">⚙️</button>
      </div>

      {/* Body */}
      <div style={sharedStyles.body}>
        <div style={styles.hotkey}>
          <span style={styles.hotkeyLabel}>Push to talk</span>
          <span style={styles.hotkeyKeys}>Ctrl + Alt + Space</span>
        </div>

        <div style={styles.statusRow}>
          <div style={styles.statusDot(voiceState)} />
          <span style={styles.statusText}>{statusLabel[voiceState]}</span>
        </div>

        {(voiceState === 'listening' || voiceState === 'processing') && liveTranscript && (
          <div style={styles.transcriptBubble}>
            <span style={styles.transcriptText}>{liveTranscript}</span>
          </div>
        )}

        {claudeResponse && (
          <div style={styles.responseBubble}>
            <span style={styles.responseLabel}>Hotaru</span>
            <span style={styles.responseText}>{claudeResponse}</span>
            {voiceState === 'responding' && <span style={styles.cursor}>▋</span>}
          </div>
        )}

        {micError && <div style={styles.errorBox}>🎤 {micError}</div>}
      </div>

      {/* Footer */}
      <div style={sharedStyles.footer}>
        <button style={styles.quitButton} onClick={() => window.close()}>Quit Hotaru</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const sharedStyles = {
  container: {
    width: '100%', height: '100vh', background: '#1a1a1a', borderRadius: 12,
    border: '1px solid #333', display: 'flex', flexDirection: 'column' as const,
    color: '#fff', userSelect: 'none' as const, overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '14px 16px', borderBottom: '1px solid #2a2a2a'
  },
  title: { fontSize: 15, fontWeight: 600, flex: 1 },
  body: {
    flex: 1, padding: '20px 16px', display: 'flex',
    flexDirection: 'column' as const, gap: 12, justifyContent: 'center'
  },
  footer: {
    padding: '12px 16px', borderTop: '1px solid #2a2a2a',
    display: 'flex', justifyContent: 'flex-end'
  }
}

const styles = {
  statusBadge: (s: VoiceState) => ({
    fontSize: 11, padding: '2px 8px', borderRadius: 99,
    background: s === 'idle' ? '#2a2a2a' : s === 'listening' ? '#1a3a1a' : s === 'processing' ? '#1a2a3a' : s === 'speaking' ? '#1a2a1a' : '#2a1a3a',
    color:      s === 'idle' ? '#555'    : s === 'listening' ? '#4ade80' : s === 'processing' ? '#60a5fa' : s === 'speaking' ? '#34d399' : '#c084fc'
  }),
  settingsButton: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 15, padding: '2px 4px', borderRadius: 4, lineHeight: 1
  },
  hotkey: {
    background: '#222', border: '1px solid #2e2e2e', borderRadius: 8,
    padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  hotkeyLabel: { fontSize: 12, color: '#888' },
  hotkeyKeys: {
    fontSize: 11, fontFamily: 'monospace', background: '#2a2a2a',
    border: '1px solid #3a3a3a', borderRadius: 4, padding: '3px 7px', color: '#bbb'
  },
  statusRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', background: '#222', border: '1px solid #2e2e2e', borderRadius: 8
  },
  statusDot: (s: VoiceState) => ({
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    background: s === 'idle' ? '#333' : s === 'listening' ? '#4ade80' : s === 'processing' ? '#60a5fa' : s === 'speaking' ? '#34d399' : '#c084fc',
    boxShadow: s !== 'idle' ? `0 0 6px ${s === 'listening' ? '#4ade80' : s === 'processing' ? '#60a5fa' : s === 'speaking' ? '#34d399' : '#c084fc'}` : 'none'
  }),
  statusText: { fontSize: 12, color: '#888' },
  transcriptBubble: {
    background: '#222', border: '1px solid #2e2e2e', borderRadius: 8,
    padding: '10px 14px', minHeight: 48
  },
  transcriptText: { fontSize: 13, color: '#ddd', lineHeight: 1.5 },
  responseBubble: {
    background: '#0f1f2e', border: '1px solid #1a3a5a', borderRadius: 8,
    padding: '10px 14px', display: 'flex', flexDirection: 'column' as const, gap: 4
  },
  responseLabel: {
    fontSize: 10, fontWeight: 600, color: '#60a5fa',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em'
  },
  responseText: { fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  cursor: { fontSize: 13, color: '#60a5fa', animation: 'blink 1s step-end infinite' },
  errorBox: {
    fontSize: 11, color: '#f87171', background: '#2a1a1a',
    border: '1px solid #5a2a2a', borderRadius: 6, padding: '7px 10px'
  },
  quitButton: {
    background: 'none', border: '1px solid #2a2a2a', borderRadius: 6,
    color: '#555', fontSize: 11, padding: '4px 10px', cursor: 'pointer'
  }
}
