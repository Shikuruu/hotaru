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
  // Optional — used for OpenAI TTS. If absent, Web Speech API is used instead.
  openAiApiKey: 'openai-api-key'
} as const

export type KeychainAccount = (typeof KEYCHAIN_ACCOUNTS)[keyof typeof KEYCHAIN_ACCOUNTS]

// The shape of a fully configured settings object.
// openAiApiKey is optional — the app works without it (falls back to Web Speech API).
export interface HotaruSettings {
  anthropicApiKey: string
  assemblyAiApiKey: string
  openAiApiKey?: string
}

// ---------------------------------------------------------------------------
// Read all settings from the OS keychain.
// Returns undefined for any key that hasn't been set yet.
// ---------------------------------------------------------------------------
export async function loadSettings(): Promise<Partial<HotaruSettings>> {
  const [anthropicApiKey, assemblyAiApiKey, openAiApiKey] = await Promise.all([
    window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.anthropicApiKey),
    window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.assemblyAiApiKey),
    window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.openAiApiKey)
  ])

  return {
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(assemblyAiApiKey ? { assemblyAiApiKey } : {}),
    ...(openAiApiKey ? { openAiApiKey } : {})
  }
}

// ---------------------------------------------------------------------------
// Save settings to the OS keychain.
// openAiApiKey is optional — skipped (not deleted) if not provided.
// ---------------------------------------------------------------------------
export async function saveSettings(settings: HotaruSettings): Promise<void> {
  const ops: Promise<void>[] = [
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.anthropicApiKey, settings.anthropicApiKey),
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.assemblyAiApiKey, settings.assemblyAiApiKey)
  ]

  if (settings.openAiApiKey) {
    ops.push(window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.openAiApiKey, settings.openAiApiKey))
  }

  await Promise.all(ops)
}

// ---------------------------------------------------------------------------
// Returns true if all *required* API keys are present in the keychain.
// openAiApiKey is optional and does not affect this check.
// ---------------------------------------------------------------------------
export async function areSettingsComplete(): Promise<boolean> {
  const settings = await loadSettings()
  return !!(settings.anthropicApiKey && settings.assemblyAiApiKey)
}

// ---------------------------------------------------------------------------
// Delete all stored keys (used for a full settings reset)
// ---------------------------------------------------------------------------
export async function clearSettings(): Promise<void> {
  await Promise.all(
    Object.values(KEYCHAIN_ACCOUNTS).map((account) => window.hotaru.keychainDelete(account))
  )
}
