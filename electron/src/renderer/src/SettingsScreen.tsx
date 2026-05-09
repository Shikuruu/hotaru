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
// Collects required API keys (Anthropic, AssemblyAI) and an optional OpenAI
// key for higher-quality TTS. Keys are stored in the OS keychain via
// settingsStore — nothing is sent anywhere until the user clicks Save.
// ---------------------------------------------------------------------------
export default function SettingsScreen({
  onSettingsSaved,
  isFirstTimeSetup
}: SettingsScreenProps): JSX.Element {
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [assemblyAiApiKey, setAssemblyAiApiKey] = useState('')
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Only the two required keys must be filled to enable Save
  const canSave = anthropicApiKey.trim() && assemblyAiApiKey.trim()

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setIsSaving(true)
    setSaveError(null)

    try {
      const settingsToSave: HotaruSettings = {
        anthropicApiKey: anthropicApiKey.trim(),
        assemblyAiApiKey: assemblyAiApiKey.trim(),
        ...(openAiApiKey.trim() ? { openAiApiKey: openAiApiKey.trim() } : {})
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
            {isFirstTimeSetup ? 'Enter your API keys to get started' : 'Update your API keys'}
          </div>
        </div>
      </div>

      <div style={styles.body}>
        {/* Required keys */}
        <div style={styles.sectionLabel}>Required</div>

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

        {/* Optional — OpenAI TTS */}
        <div style={{ ...styles.sectionLabel, marginTop: 4 }}>
          Optional
        </div>
        <ApiKeyField
          label="OpenAI API Key"
          placeholder="sk-... (leave blank to use system voice)"
          helpUrl="https://platform.openai.com/api-keys"
          value={openAiApiKey}
          onChange={setOpenAiApiKey}
          hint="Used for higher-quality voice (OpenAI TTS). If blank, the built-in system voice is used."
        />

        {saveError && <div style={styles.errorMessage}>{saveError}</div>}
      </div>

      <div style={styles.footer}>
        <button
          style={styles.saveButton(!!canSave && !isSaving)}
          onClick={handleSave}
          disabled={!canSave || isSaving}
        >
          {isSaving ? 'Saving…' : 'Save Keys'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ApiKeyField — a single labelled input with show/hide toggle and help link
// ---------------------------------------------------------------------------
interface ApiKeyFieldProps {
  label: string
  placeholder: string
  helpUrl: string
  value: string
  onChange: (value: string) => void
  isSecret?: boolean
  hint?: string
}

function ApiKeyField({
  label,
  placeholder,
  helpUrl,
  value,
  onChange,
  isSecret = true,
  hint
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
      {hint && <div style={styles.fieldHint}>{hint}</div>}
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
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#444',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em'
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
  fieldHint: {
    fontSize: 10,
    color: '#555',
    lineHeight: 1.4
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
