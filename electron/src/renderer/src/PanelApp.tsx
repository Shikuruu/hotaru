import { useState, useEffect, useRef } from 'react'
import SettingsScreen from './SettingsScreen'
import { areSettingsComplete, loadSettings } from './lib/settingsStore'
import { AudioCapture } from './lib/audioCapture'
import { AssemblyAIStreamingClient } from './lib/assemblyaiStreaming'
import { captureAllScreens, ScreenCapture } from './lib/screenCapture'
import { askClaude } from './lib/claudeClient'
import { speak, stopSpeaking } from './lib/ttsClient'

// ---------------------------------------------------------------------------
// Parse [POINT:x:y:label:screenN] tags out of a Claude response.
// Returns an array ready to send to the overlay.
// ---------------------------------------------------------------------------
function parsePointTags(text: string): OverlayPoint[] {
  const points: OverlayPoint[] = []
  // Format: [POINT:0.42:0.31:Submit button:Screen 1]
  const re = /\[POINT:([0-9.]+):([0-9.]+):([^:[\]]+):([^\]]+)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const x = parseFloat(match[1])
    const y = parseFloat(match[2])
    if (isNaN(x) || isNaN(y)) continue
    points.push({ x, y, label: match[3].trim(), screen: match[4].trim() })
  }
  return points
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'responding' | 'speaking'
type AppScreen = 'loading' | 'settings' | 'main'

// ---------------------------------------------------------------------------
// PanelApp — root component for the tray dropdown panel.
//
// On mount checks whether API keys exist in the OS keychain:
//   - Missing → SettingsScreen (first-time setup)
//   - Present  → MainScreen (companion controls)
//
// Push-to-talk pipeline wired here:
//   key down → AudioCapture + AssemblyAI WebSocket
//   key up   → stop audio + forceEndUtterance → final transcript
//   transcript ready → 'processing' state (Claude step wired in next step)
// ---------------------------------------------------------------------------
export default function PanelApp(): JSX.Element {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('loading')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [audioLevel, setAudioLevel] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [claudeResponse, setClaudeResponse] = useState('')
  const [micError, setMicError] = useState<string | null>(null)

  // Stable refs — never trigger re-renders, always hold the latest instances
  const audioCaptureRef = useRef<AudioCapture>(new AudioCapture())
  const assemblyAiClientRef = useRef<AssemblyAIStreamingClient | null>(null)
  const assemblyAiApiKeyRef = useRef<string>('')
  const anthropicApiKeyRef = useRef<string>('')
  const openAiApiKeyRef = useRef<string>('')
  // Screenshots captured on PTT stop — passed to Claude alongside the transcript
  const pendingScreenshotsRef = useRef<ScreenCapture[]>([])

  // On mount: check keychain and load API keys
  useEffect(() => {
    async function initialise(): Promise<void> {
      const isComplete = await areSettingsComplete()
      if (!isComplete) {
        setCurrentScreen('settings')
        return
      }
      const settings = await loadSettings()
      assemblyAiApiKeyRef.current = settings.assemblyAiApiKey ?? ''
      anthropicApiKeyRef.current = settings.anthropicApiKey ?? ''
      openAiApiKeyRef.current = settings.openAiApiKey ?? ''
      setCurrentScreen('main')
    }
    initialise()
  }, [])

  // Re-load API keys whenever the user saves new settings
  async function handleSettingsSaved(): Promise<void> {
    const settings = await loadSettings()
    assemblyAiApiKeyRef.current = settings.assemblyAiApiKey ?? ''
    anthropicApiKeyRef.current = settings.anthropicApiKey ?? ''
    openAiApiKeyRef.current = settings.openAiApiKey ?? ''
    setCurrentScreen('main')
  }

  // Listen for push-to-talk events from the main process (uiohook-napi)
  useEffect(() => {
    window.hotaru.onPushToTalkStart(async () => {
      stopSpeaking()
      window.hotaru.sendOverlayPoints([]) // clear any previous firefly cursors
      setMicError(null)
      setLiveTranscript('')
      setClaudeResponse('')
      setVoiceState('listening')

      // Create a fresh AssemblyAI client for this session and connect
      const assemblyAiClient = new AssemblyAIStreamingClient(assemblyAiApiKeyRef.current)
      assemblyAiClientRef.current = assemblyAiClient

      await assemblyAiClient.connect({
        onPartialTranscript: (text) => setLiveTranscript(text),

        onFinalTranscript: (finalText) => {
          setLiveTranscript(finalText)
          setVoiceState('processing')
          setClaudeResponse('')

          if (!finalText.trim()) {
            // Nothing was said — bail out silently
            setVoiceState('idle')
            return
          }

          console.log('[Hotaru] Final transcript:', finalText)

          // Call Claude with the transcript + any captured screenshots.
          // Screenshots may still be landing from the parallel capture — they'll
          // be in pendingScreenshotsRef by the time this async call starts.
          setVoiceState('responding')
          askClaude(
            anthropicApiKeyRef.current,
            finalText,
            pendingScreenshotsRef.current,
            {
              onTextDelta: (delta) => {
                setClaudeResponse((prev) => prev + delta)
              },
              onComplete: (fullText) => {
                console.log('[Hotaru] Claude response:', fullText)

                // Parse and send [POINT] annotations to the overlay
                const points = parsePointTags(fullText)
                if (points.length > 0) {
                  window.hotaru.sendOverlayPoints(points)
                }

                setVoiceState('speaking')
                speak(fullText, openAiApiKeyRef.current || undefined).finally(() => {
                  setVoiceState('idle')
                })
              },
              onError: (error) => {
                console.error('[Hotaru] Claude error:', error)
                setMicError(`Claude error: ${error.message}`)
                setVoiceState('idle')
              }
            }
          )
        },

        onError: (error) => {
          console.error('[Hotaru] AssemblyAI error:', error)
          setMicError(`Transcription error: ${error.message}`)
          setVoiceState('idle')
          setLiveTranscript('')
          setAudioLevel(0)
        }
      })

      // Start audio capture — PCM16 chunks stream directly to AssemblyAI
      audioCaptureRef.current.start({
        onPcm16Chunk: (chunk) => assemblyAiClientRef.current?.sendAudioChunk(chunk),
        onAudioLevel: (level) => setAudioLevel(level),
        onError: (error) => {
          setMicError(error.message)
          setVoiceState('idle')
          setAudioLevel(0)
          assemblyAiClientRef.current?.disconnect()
        }
      })
    })

    window.hotaru.onPushToTalkStop(() => {
      // Stop mic immediately so no more audio is captured
      audioCaptureRef.current.stop()
      setAudioLevel(0)

      // Capture all screens and finalise transcript in parallel —
      // both are fire-and-forget here; screenshots land in the ref
      // before onFinalTranscript fires (network RTT >> screen capture time)
      pendingScreenshotsRef.current = []
      captureAllScreens()
        .then((screens) => {
          pendingScreenshotsRef.current = screens
          console.log(`[Hotaru] Captured ${screens.length} screen(s)`)
        })
        .catch((err) => {
          console.warn('[Hotaru] Screenshot capture failed:', err)
        })

      // Signal AssemblyAI to finalise — triggers onFinalTranscript callback above
      assemblyAiClientRef.current?.forceEndUtterance()
    })

    return () => {
      stopSpeaking()
      audioCaptureRef.current.stop()
      assemblyAiClientRef.current?.disconnect()
      window.hotaru.removeAllListeners('push-to-talk-start')
      window.hotaru.removeAllListeners('push-to-talk-stop')
    }
  }, [])

  if (currentScreen === 'loading') {
    return <LoadingScreen />
  }

  if (currentScreen === 'settings') {
    return (
      <SettingsScreen
        isFirstTimeSetup={currentScreen === 'settings'}
        onSettingsSaved={handleSettingsSaved}
      />
    )
  }

  return (
    <MainScreen
      voiceState={voiceState}
      audioLevel={audioLevel}
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
  audioLevel: number
  liveTranscript: string
  claudeResponse: string
  micError: string | null
  onOpenSettings: () => void
}

function MainScreen({
  voiceState,
  audioLevel,
  liveTranscript,
  claudeResponse,
  micError,
  onOpenSettings
}: MainScreenProps): JSX.Element {
  const statusLabel: Record<VoiceState, string> = {
    idle: 'Ready',
    listening: 'Listening…',
    processing: 'Thinking…',
    responding: 'Responding…',
    speaking: 'Speaking…'
  }

  return (
    <div style={sharedStyles.container}>
      {/* Header */}
      <div style={sharedStyles.header}>
        <span style={{ fontSize: 20 }}>🔥</span>
        <span style={sharedStyles.title}>Hotaru</span>
        <span style={styles.statusBadge(voiceState)}>{statusLabel[voiceState]}</span>
        <button style={styles.settingsButton} onClick={onOpenSettings} title="Settings">
          ⚙️
        </button>
      </div>

      {/* Body */}
      <div style={sharedStyles.body}>
        <div style={styles.hotkey}>
          <span style={styles.hotkeyLabel}>Push to talk</span>
          <span style={styles.hotkeyKeys}>Ctrl + Alt + Space</span>
        </div>

        {/* Status row with audio level bar */}
        <div style={styles.statusRow}>
          <div style={styles.statusDot(voiceState)} />
          <span style={styles.statusText}>{statusLabel[voiceState]}</span>
          {voiceState === 'listening' && (
            <div style={styles.levelTrack}>
              <div style={styles.levelFill(audioLevel)} />
            </div>
          )}
        </div>

        {/* Live transcript — shown while listening / waiting for Claude */}
        {(voiceState === 'listening' || voiceState === 'processing') && liveTranscript && (
          <div style={styles.transcriptBubble}>
            <span style={styles.transcriptText}>{liveTranscript}</span>
          </div>
        )}

        {/* Claude response — streams in while responding, stays when idle */}
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
        <button style={styles.quitButton} onClick={() => window.close()}>
          Quit Hotaru
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const sharedStyles = {
  container: {
    width: '100%',
    height: '100vh',
    background: '#1a1a1a',
    borderRadius: 12,
    border: '1px solid #333',
    display: 'flex',
    flexDirection: 'column' as const,
    color: '#fff',
    userSelect: 'none' as const,
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 16px',
    borderBottom: '1px solid #2a2a2a'
  },
  title: { fontSize: 15, fontWeight: 600, flex: 1 },
  body: {
    flex: 1,
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    justifyContent: 'center'
  },
  footer: {
    padding: '12px 16px',
    borderTop: '1px solid #2a2a2a',
    display: 'flex',
    justifyContent: 'flex-end'
  }
}

const styles = {
  statusBadge: (state: VoiceState) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 99,
    background:
      state === 'idle' ? '#2a2a2a'
      : state === 'listening' ? '#1a3a1a'
      : state === 'processing' ? '#1a2a3a'
      : state === 'speaking' ? '#1a2a1a'
      : '#2a1a3a',
    color:
      state === 'idle' ? '#555'
      : state === 'listening' ? '#4ade80'
      : state === 'processing' ? '#60a5fa'
      : state === 'speaking' ? '#34d399'
      : '#c084fc'
  }),
  settingsButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 15,
    padding: '2px 4px',
    borderRadius: 4,
    lineHeight: 1
  },
  hotkey: {
    background: '#222',
    border: '1px solid #2e2e2e',
    borderRadius: 8,
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  hotkeyLabel: { fontSize: 12, color: '#888' },
  hotkeyKeys: {
    fontSize: 11,
    fontFamily: 'monospace',
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    borderRadius: 4,
    padding: '3px 7px',
    color: '#bbb'
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: '#222',
    border: '1px solid #2e2e2e',
    borderRadius: 8
  },
  statusDot: (state: VoiceState) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    background:
      state === 'idle' ? '#333'
      : state === 'listening' ? '#4ade80'
      : state === 'processing' ? '#60a5fa'
      : state === 'speaking' ? '#34d399'
      : '#c084fc',
    boxShadow:
      state !== 'idle'
        ? `0 0 6px ${
            state === 'listening' ? '#4ade80'
            : state === 'processing' ? '#60a5fa'
            : state === 'speaking' ? '#34d399'
            : '#c084fc'
          }`
        : 'none'
  }),
  statusText: { fontSize: 12, color: '#888' },
  // Audio level track + fill bar
  levelTrack: {
    marginLeft: 'auto',
    width: 64,
    height: 4,
    borderRadius: 2,
    background: '#1a3a1a',
    overflow: 'hidden' as const,
    flexShrink: 0
  },
  levelFill: (level: number) => ({
    height: '100%',
    width: `${Math.round(level * 100)}%`,
    background: '#4ade80',
    borderRadius: 2,
    transition: 'width 60ms linear'
  }),
  // Live transcript shown while listening / processing
  transcriptBubble: {
    background: '#222',
    border: '1px solid #2e2e2e',
    borderRadius: 8,
    padding: '10px 14px',
    minHeight: 48
  },
  transcriptText: {
    fontSize: 13,
    color: '#ddd',
    lineHeight: 1.5
  },
  // Claude's streamed response
  responseBubble: {
    background: '#0f1f2e',
    border: '1px solid #1a3a5a',
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4
  },
  responseLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#60a5fa',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em'
  },
  responseText: {
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const
  },
  cursor: {
    fontSize: 13,
    color: '#60a5fa',
    animation: 'blink 1s step-end infinite'
  },
  errorBox: {
    fontSize: 11,
    color: '#f87171',
    background: '#2a1a1a',
    border: '1px solid #5a2a2a',
    borderRadius: 6,
    padding: '7px 10px'
  },
  quitButton: {
    background: 'none',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#555',
    fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer'
  }
}
