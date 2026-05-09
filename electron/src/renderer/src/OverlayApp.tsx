import { useState, useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// OverlayApp — fullscreen transparent layer that sits above all windows.
// The BrowserWindow is set to click-through (setIgnoreMouseEvents) so it
// never blocks the user's interaction with whatever is on screen.
//
// Two things are rendered here:
//   1. Listening indicator — small pill in the corner while PTT is held
//   2. Firefly cursors — glowing amber dots at each [POINT] coordinate from
//      Claude's response, with a label bubble; auto-fade after 4 seconds
// ---------------------------------------------------------------------------

interface ActivePoint {
  id: number          // unique key for React
  x: number           // 0–1 fraction of viewport width
  y: number           // 0–1 fraction of viewport height
  label: string
  screen: string
  phase: 'in' | 'hold' | 'out'  // animation phase
}

let nextPointId = 0

const FADE_IN_MS = 300
const HOLD_MS = 3500
const FADE_OUT_MS = 600

export default function OverlayApp(): JSX.Element {
  const [isListening, setIsListening] = useState(false)
  const [points, setPoints] = useState<ActivePoint[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    window.hotaru.onPushToTalkStart(() => setIsListening(true))
    window.hotaru.onPushToTalkStop(() => setIsListening(false))

    window.hotaru.onOverlayPoint((incoming) => {
      // Empty array = clear all points
      if (incoming.length === 0) {
        // Cancel all pending timers
        timersRef.current.forEach((t) => clearTimeout(t))
        timersRef.current.clear()
        setPoints([])
        return
      }

      // Stagger each point by 200ms so they don't all pop at once
      incoming.forEach((pt, i) => {
        const id = nextPointId++
        const delay = i * 200

        const addTimer = setTimeout(() => {
          const newPoint: ActivePoint = { id, ...pt, phase: 'in' }
          setPoints((prev) => [...prev, newPoint])

          // Transition to 'hold' after fade-in
          const holdTimer = setTimeout(() => {
            setPoints((prev) =>
              prev.map((p) => (p.id === id ? { ...p, phase: 'hold' } : p))
            )

            // Transition to 'out' (fade out) after hold
            const outTimer = setTimeout(() => {
              setPoints((prev) =>
                prev.map((p) => (p.id === id ? { ...p, phase: 'out' } : p))
              )

              // Remove from DOM after fade-out completes
              const removeTimer = setTimeout(() => {
                setPoints((prev) => prev.filter((p) => p.id !== id))
                timersRef.current.delete(id)
              }, FADE_OUT_MS)

              timersRef.current.set(id, removeTimer)
            }, HOLD_MS)

            timersRef.current.set(id, outTimer)
          }, FADE_IN_MS)

          timersRef.current.set(id, holdTimer)
        }, delay)

        timersRef.current.set(id, addTimer)
      })
    })

    return () => {
      timersRef.current.forEach((t) => clearTimeout(t))
      window.hotaru.removeAllListeners('push-to-talk-start')
      window.hotaru.removeAllListeners('push-to-talk-stop')
      window.hotaru.removeAllListeners('overlay-point')
    }
  }, [])

  return (
    <>
      {/* CSS keyframe animations injected once */}
      <style>{KEYFRAMES}</style>

      {/* Listening indicator — bottom-right corner */}
      {isListening && (
        <div style={styles.listeningPill}>
          <div style={styles.listeningDot} />
          <span style={styles.listeningText}>Listening…</span>
        </div>
      )}

      {/* Firefly cursors */}
      {points.map((pt) => (
        <FireflyPoint key={pt.id} point={pt} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// FireflyPoint — a single animated cursor
// ---------------------------------------------------------------------------
function FireflyPoint({ point }: { point: ActivePoint }): JSX.Element {
  const opacity = point.phase === 'in' ? 0 : point.phase === 'hold' ? 1 : 0
  const transition =
    point.phase === 'in'
      ? `opacity ${FADE_IN_MS}ms ease-out`
      : point.phase === 'out'
        ? `opacity ${FADE_OUT_MS}ms ease-in`
        : 'none'

  // Clamp so label never goes off-screen edge
  const leftPct = Math.min(Math.max(point.x * 100, 2), 90)
  const topPct = Math.min(Math.max(point.y * 100, 2), 92)
  // Place label above or below depending on vertical position
  const labelAbove = topPct > 50

  return (
    <div
      style={{
        position: 'fixed',
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        opacity,
        transition,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 9999
      }}
    >
      {/* Label above */}
      {labelAbove && <PointLabel label={point.label} phase={point.phase} />}

      {/* Firefly dot */}
      <div style={styles.fireflyOuter}>
        <div style={styles.fireflyInner} />
      </div>

      {/* Label below */}
      {!labelAbove && <PointLabel label={point.label} phase={point.phase} />}
    </div>
  )
}

function PointLabel({ label, phase }: { label: string; phase: string }): JSX.Element {
  return (
    <div
      style={{
        ...styles.label,
        animation: phase === 'hold' ? 'floatY 3s ease-in-out infinite' : 'none'
      }}
    >
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = {
  listeningPill: {
    position: 'fixed' as const,
    bottom: 32,
    right: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(0,0,0,0.72)',
    backdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 99,
    padding: '8px 16px',
    pointerEvents: 'none' as const
  },
  listeningDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#4ade80',
    boxShadow: '0 0 8px #4ade80',
    animation: 'pulse 1.2s ease-in-out infinite'
  },
  listeningText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: 500
  },
  // Outer ring — soft amber halo
  fireflyOuter: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(251,191,36,0.35) 0%, rgba(251,191,36,0) 70%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fireflyGlow 1.8s ease-in-out infinite',
    filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.6))'
  },
  // Inner bright core
  fireflyInner: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#fbbf24',
    boxShadow: '0 0 6px #fbbf24, 0 0 14px rgba(251,191,36,0.8)'
  },
  label: {
    background: 'rgba(0,0,0,0.75)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(251,191,36,0.3)',
    borderRadius: 6,
    padding: '4px 10px',
    color: '#fef3c7',
    fontSize: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const
  }
}

// ---------------------------------------------------------------------------
// CSS keyframe definitions
// ---------------------------------------------------------------------------
const KEYFRAMES = `
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.5; transform: scale(0.85); }
  }

  @keyframes fireflyGlow {
    0%, 100% { transform: scale(1);    opacity: 0.9; }
    50%       { transform: scale(1.35); opacity: 1;   }
  }

  @keyframes floatY {
    0%, 100% { transform: translateY(0px); }
    50%       { transform: translateY(-4px); }
  }
`
