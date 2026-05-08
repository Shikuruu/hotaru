import { useState } from 'react'
import { saveSettings, type HotaruSettings } from './lib/settingsStore'

interface SettingsScreenProps {
  // Called after the user successfully saves their API keys
  onSettingsSaved: () => void
  // Whether this is first-time setup (true) or editing existing keys (false)
  isFirstTimeSetup: boolean
}

// ---------------------------------------------------------------------------
// SettingsScreen — shown on first launch or when the user clicks "Settings".
// Collects the three API keys + ElevenLabs voice ID and stores them in the
// OS keychain via settingsStore. Nothing is sent anywhere until the user
// explicitly clicks Save.
// ---------------------------------------------------------------------------
export default function SettingsScreen({
  onSettingsSaved,
  isFirstTimeSetup
}: SettingsScreenProps): JSX.Element {
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [assemblyAiApiKey, setAssemblyAiApiKey] = useState('')
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('')
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const allFieldsFilled =
    anthropicApiKey.trim() &&
    assemblyAiApiKey.trim() &&
    elevenLabsApiKey.trim() &&
    elevenLabsVoiceId.trim()

  async function handleSave(): Promise<void> {
    if (!allFieldsFilled) return
    setIsSaving(true)
    setSaveError(null)

    try {
      const settingsToSave: HotaruSettings = {
        anthropicApiKey: anthropicApiKey.trim(),
        assemblyAiApiKey: assemblyAiApiKey.trim(),
        elevenLabsApiKey: elevenLabsApiKey.trim(),
        elevenLabsVoiceId: elevenLabsVoiceId.trim()
      }
      await saveSettings(settingsToSave)
      onSettingsSaved()
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save keys. Please try again.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.logo}>🔥</span>
        <div>
          <div style={styles.title}>{isFirstTimeSetup ? 'Welcome to Hotaru' : 'Settings'}</div>
          <div style={styles.subtitle}>
            {isFirstTimeSetup
              ? 'Enter your API keys to get started'
              : 'Update your API keys'}
          </div>
        </div>
      </div>

      <div style={styles.body}>
        <ApiKeyField
          label="Anthropic API Key"
          placeholder="sk-ant-..."
          helpUrl="https://console.anthropic.com"
          value={anthropicApiKey}
          onChange={setAnthropicApiKey}
        />
        <ApiKeyField
          label="AssemblyAI API Key"
          placeholder="Your AssemblyAI key"
          helpUrl="https://www.assemblyai.com"
          value={assemblyAiApiKey}
          onChange={setAssemblyAiApiKey}
        />
        <ApiKeyField
          label="ElevenLabs API Key"
          placeholder="Your ElevenLabs key"
          helpUrl="https://elevenlabs.io"
          value={elevenLabsApiKey}
          onChange={setElevenLabsApiKey}
        />
        <ApiKeyField
          label="ElevenLabs Voice ID"
          placeholder="e.g. kPzsL2i3teMYv0FxEYQ6"
          helpUrl="https://elevenlabs.io/voice-lab"
          value={elevenLabsVoiceId}
          onChange={setElevenLabsVoiceId}
          isSecret={false}
        />

        {saveError && <div style={styles.errorMessage}>{saveError}</div>}
      </div>

      <div style={styles.footer}>
        <button
          style={styles.saveButton(!!allFieldsFilled && !isSaving)}
          onClick={handleSave}
          disabled={!allFieldsFilled || isSaving}
        >
          {isSaving ? 'Saving…' : 'Save Keys'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ApiKeyField — a single labelled input with a link to get the key
// ---------------------------------------------------------------------------
interface ApiKeyFieldProps {
  label: string
  placeholder: string
  helpUrl: string
  value: string
  onChange: (value: string) => void
  isSecret?: boolean
}

function ApiKeyField({
  label,
  placeholder,
  helpUrl,
  value,
  onChange,
  isSecret = true
}: ApiKeyFieldProps): JSX.Element {
  const [isRevealed, setIsRevealed] = useState(false)

  return (
    <div style={styles.fieldGroup}>
      <div style={styles.fieldLabelRow}>
        <label style={styles.fieldLabel}>{label}</label>
        <a
          href={helpUrl}
          target="_blank"
          rel="noreferrer"
          style={styles.fieldHelpLink}
          onClick={(e) => {
            e.preventDefault()
            // Open in the system browser rather than a new Electron window
            window.open(helpUrl, '_blank')
          }}
        >
          Get key ↗
        </a>
      </div>
      <div style={styles.fieldInputRow}>
        <input
          type={isSecret && !isRevealed ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={styles.fieldInput}
          spellCheck={false}
          autoComplete="off"
        />
        {isSecret && (
          <button
            style={styles.revealButton}
            onClick={() => setIsRevealed((prev) => !prev)}
            title={isRevealed ? 'Hide' : 'Show'}
          >
            {isRevealed ? '🙈' : '👁️'}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
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
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 20px',
    borderBottom: '1px solid #2a2a2a'
  },
  logo: { fontSize: 24 },
  title: { fontSize: 15, fontWeight: 600 },
  subtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  body: {
    flex: 1,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    overflowY: 'auto' as const
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6
  },
  fieldLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline'
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: '#aaa'
  },
  fieldHelpLink: {
    fontSize: 11,
    color: '#555',
    textDecoration: 'none',
    cursor: 'pointer'
  },
  fieldInputRow: {
    display: 'flex',
    gap: 6
  },
  fieldInput: {
    flex: 1,
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '7px 10px',
    outline: 'none',
    width: '100%'
  },
  revealButton: {
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    padding: '0 8px',
    flexShrink: 0
  },
  errorMessage: {
    fontSize: 12,
    color: '#f87171',
    background: '#2a1a1a',
    border: '1px solid #5a2a2a',
    borderRadius: 6,
    padding: '8px 12px'
  },
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid #2a2a2a'
  },
  saveButton: (enabled: boolean) => ({
    width: '100%',
    padding: '9px',
    borderRadius: 8,
    border: 'none',
    background: enabled ? '#f97316' : '#2a2a2a',
    color: enabled ? '#fff' : '#555',
    fontSize: 13,
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
    transition: 'background 0.15s'
  })
}
