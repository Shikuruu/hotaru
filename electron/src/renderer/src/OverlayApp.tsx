import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// OverlayApp — the fullscreen transparent layer that sits over everything.
// Shows the animated cursor, response text bubble, and waveform.
// The window is click-through (setIgnoreMouseEvents) so it never blocks the user.
// ---------------------------------------------------------------------------
export default function OverlayApp(): JSX.Element {
  const [isListening, setIsListening] = useState(false)
  const [responseText, setResponseText] = useState('')

  useEffect(() => {
    // Listen for push-to-talk events sent from main process via preload
    window.hotaru.onPushToTalkStart(() => setIsListening(true))
    window.hotaru.onPushToTalkStop(() => setIsListening(false))

    return () => {
      window.hotaru.removeAllListeners('push-to-talk-start')
      window.hotaru.removeAllListeners('push-to-talk-stop')
    }
  }, [])

  if (!isListening && !responseText) {
    // Nothing to show — render nothing (overlay is transparent)
    return <></>
  }

  return (
    <div style={styles.container}>
      {isListening && (
        <div style={styles.listeningIndicator}>
          <div style={styles.dot} />
          <span style={styles.listeningText}>Listening…</span>
        </div>
      )}
      {responseText && (
        <div style={styles.responseBubble}>
          {responseText}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    position: 'fixed' as const,
    bottom: 80,
    right: 40,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    gap: 12,
    pointerEvents: 'none' as const
  },
  listeningIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(0,0,0,0.75)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 99,
    padding: '8px 16px'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#4ade80',
    boxShadow: '0 0 8px #4ade80',
    animation: 'pulse 1s infinite'
  },
  listeningText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  responseBubble: {
    maxWidth: 400,
    background: 'rgba(0,0,0,0.8)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '12px 16px',
    color: '#fff',
    fontSize: 14,
    lineHeight: 1.6,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }
}
