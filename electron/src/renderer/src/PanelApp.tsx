import { useState } from 'react'

// ---------------------------------------------------------------------------
// PanelApp — the dropdown panel that opens from the tray icon.
// This is the control center: settings, status, API key setup, quit button.
// ---------------------------------------------------------------------------
export default function PanelApp(): JSX.Element {
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'responding'>('idle')

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.logo}>🔥</span>
        <span style={styles.title}>Hotaru</span>
        <span style={styles.statusBadge(status)}>{status}</span>
      </div>

      <div style={styles.body}>
        <p style={styles.hint}>
          Press <kbd style={styles.kbd}>Ctrl + Alt + Space</kbd> to talk
        </p>
      </div>

      <div style={styles.footer}>
        <button style={styles.quitButton} onClick={() => window.close()}>
          Quit
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline styles — will migrate to CSS modules / Tailwind once structure settles
// ---------------------------------------------------------------------------
const styles = {
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
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a2a'
  },
  logo: {
    fontSize: 20
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    flex: 1
  },
  statusBadge: (status: string) => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 99,
    background: status === 'idle' ? '#2a2a2a' : status === 'listening' ? '#1a3a1a' : '#1a2a3a',
    color: status === 'idle' ? '#666' : status === 'listening' ? '#4ade80' : '#60a5fa'
  }),
  body: {
    flex: 1,
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  hint: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center' as const,
    lineHeight: 1.6
  },
  kbd: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '1px 5px',
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#ccc'
  },
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid #2a2a2a',
    display: 'flex',
    justifyContent: 'flex-end'
  },
  quitButton: {
    background: 'none',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#666',
    fontSize: 12,
    padding: '4px 12px',
    cursor: 'pointer'
  }
}
