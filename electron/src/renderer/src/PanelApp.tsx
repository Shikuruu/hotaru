import { useState, useEffect } from 'react'
import SettingsScreen from './SettingsScreen'
import { areSettingsComplete } from './lib/settingsStore'

type VoiceState = 'idle' | 'listening' | 'processing' | 'responding'
type AppScreen = 'loading' | 'settings' | 'main'

// ---------------------------------------------------------------------------
// PanelApp — root component for the tray dropdown panel.
//
// On mount, checks whether API keys exist in the OS keychain:
//   - If not → shows SettingsScreen (first-time setup)
//   - If yes → shows the main companion controls
//
// The user can always get back to settings via the gear icon.
// ---------------------------------------------------------------------------
export default function PanelApp(): JSX.Element {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('loading')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')

  // On mount, check if API keys are stored — determines which screen to show
  useEffect(() => {
    areSettingsComplete().then((isComplete) => {
      setCurrentScreen(isComplete ? 'main' : 'settings')
    })
  }, [])

  // Listen for push-to-talk state changes from the main process
  useEffect(() => {
    window.hotaru.onPushToTalkStart(() => setVoiceState('listening'))
    window.hotaru.onPushToTalkStop(() => setVoiceState('idle'))

    return () => {
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
        isFirstTimeSetup={true}
        onSettingsSaved={() => setCurrentScreen('main')}
      />
    )
  }

  return (
    <MainScreen
      voiceState={voiceState}
      onOpenSettings={() => setCurrentScreen('settings')}
    />
  )
}

// ---------------------------------------------------------------------------
// LoadingScreen — shown for the brief moment while checking the keychain
// ---------------------------------------------------------------------------
function LoadingScreen(): JSX.Element {
  return (
    <div style={{ ...sharedStyles.container, alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 24 }}>🔥</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MainScreen — the normal companion controls shown once keys are configured
// ---------------------------------------------------------------------------
interface MainScreenProps {
  voiceState: VoiceState
  onOpenSettings: () => void
}

function MainScreen({ voiceState, onOpenSettings }: MainScreenProps): JSX.Element {
  const statusLabel: Record<VoiceState, string> = {
    idle: 'Ready',
    listening: 'Listening…',
    processing: 'Thinking…',
    responding: 'Responding…'
  }

  return (
    <div style={sharedStyles.container}>
      {/* Header */}
      <div style={sharedStyles.header}>
        <span style={{ fontSize: 20 }}>🔥</span>
        <span style={sharedStyles.title}>Hotaru</span>
        <span style={styles.statusBadge(voiceState)}>{statusLabel[voiceState]}</span>
        <button
          style={styles.settingsButton}
          onClick={onOpenSettings}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Body */}
      <div style={sharedStyles.body}>
        <div style={styles.hotkey}>
          <span style={styles.hotkeyLabel}>Push to talk</span>
          <span style={styles.hotkeyKeys}>Ctrl + Alt + Space</span>
        </div>

        <div style={styles.statusIndicator(voiceState)}>
          <div style={styles.statusDot(voiceState)} />
          <span style={styles.statusText}>{statusLabel[voiceState]}</span>
        </div>
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
  title: {
    fontSize: 15,
    fontWeight: 600,
    flex: 1
  },
  body: {
    flex: 1,
    padding: '20px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
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
      state === 'idle'
        ? '#2a2a2a'
        : state === 'listening'
          ? '#1a3a1a'
          : state === 'processing'
            ? '#1a2a3a'
            : '#2a1a3a',
    color:
      state === 'idle'
        ? '#555'
        : state === 'listening'
          ? '#4ade80'
          : state === 'processing'
            ? '#60a5fa'
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
  hotkeyLabel: {
    fontSize: 12,
    color: '#888'
  },
  hotkeyKeys: {
    fontSize: 11,
    fontFamily: 'monospace',
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    borderRadius: 4,
    padding: '3px 7px',
    color: '#bbb'
  },
  statusIndicator: (_state: VoiceState) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: '#222',
    border: '1px solid #2e2e2e',
    borderRadius: 8
  }),
  statusDot: (state: VoiceState) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background:
      state === 'idle'
        ? '#333'
        : state === 'listening'
          ? '#4ade80'
          : state === 'processing'
            ? '#60a5fa'
            : '#c084fc',
    boxShadow:
      state !== 'idle'
        ? `0 0 6px ${state === 'listening' ? '#4ade80' : state === 'processing' ? '#60a5fa' : '#c084fc'}`
        : 'none',
    flexShrink: 0
  }),
  statusText: {
    fontSize: 12,
    color: '#888'
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
