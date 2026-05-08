// ---------------------------------------------------------------------------
// settingsStore.ts
//
// Typed wrapper around the OS keychain (keytar, via the preload IPC bridge).
// All API keys and config values are stored here — nothing sensitive ever
// touches localStorage, sessionStorage, or any file on disk.
//
// Keychain account names are stable string constants so they never drift.
// ---------------------------------------------------------------------------

// The account names used to store each key in the OS keychain
export const KEYCHAIN_ACCOUNTS = {
  anthropicApiKey: 'anthropic-api-key',
  assemblyAiApiKey: 'assemblyai-api-key',
  elevenLabsApiKey: 'elevenlabs-api-key',
  elevenLabsVoiceId: 'elevenlabs-voice-id'
} as const

export type KeychainAccount = (typeof KEYCHAIN_ACCOUNTS)[keyof typeof KEYCHAIN_ACCOUNTS]

// The shape of a fully configured settings object
export interface HotaruSettings {
  anthropicApiKey: string
  assemblyAiApiKey: string
  elevenLabsApiKey: string
  elevenLabsVoiceId: string
}

// ---------------------------------------------------------------------------
// Read all settings from the OS keychain.
// Returns null for any key that hasn't been set yet.
// ---------------------------------------------------------------------------
export async function loadSettings(): Promise<Partial<HotaruSettings>> {
  const [anthropicApiKey, assemblyAiApiKey, elevenLabsApiKey, elevenLabsVoiceId] =
    await Promise.all([
      window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.anthropicApiKey),
      window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.assemblyAiApiKey),
      window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.elevenLabsApiKey),
      window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.elevenLabsVoiceId)
    ])

  return {
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(assemblyAiApiKey ? { assemblyAiApiKey } : {}),
    ...(elevenLabsApiKey ? { elevenLabsApiKey } : {}),
    ...(elevenLabsVoiceId ? { elevenLabsVoiceId } : {})
  }
}

// ---------------------------------------------------------------------------
// Save all settings to the OS keychain.
// ---------------------------------------------------------------------------
export async function saveSettings(settings: HotaruSettings): Promise<void> {
  await Promise.all([
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.anthropicApiKey, settings.anthropicApiKey),
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.assemblyAiApiKey, settings.assemblyAiApiKey),
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.elevenLabsApiKey, settings.elevenLabsApiKey),
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.elevenLabsVoiceId, settings.elevenLabsVoiceId)
  ])
}

// ---------------------------------------------------------------------------
// Returns true if all required API keys are present in the keychain.
// Used by PanelApp to decide whether to show the settings screen or main UI.
// ---------------------------------------------------------------------------
export async function areSettingsComplete(): Promise<boolean> {
  const settings = await loadSettings()
  return !!(
    settings.anthropicApiKey &&
    settings.assemblyAiApiKey &&
    settings.elevenLabsApiKey &&
    settings.elevenLabsVoiceId
  )
}

// ---------------------------------------------------------------------------
// Delete all stored keys (used for a full settings reset)
// ---------------------------------------------------------------------------
export async function clearSettings(): Promise<void> {
  await Promise.all(
    Object.values(KEYCHAIN_ACCOUNTS).map((account) => window.hotaru.keychainDelete(account))
  )
}
