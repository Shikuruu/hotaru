// ---------------------------------------------------------------------------
// settingsStore.ts
//
// Typed wrapper around the OS keychain (keytar, via the preload IPC bridge).
// All API keys are stored here — nothing sensitive touches localStorage or disk.
// ---------------------------------------------------------------------------

export const KEYCHAIN_ACCOUNTS = {
  anthropicApiKey: 'anthropic-api-key',
  // Optional — used for OpenAI TTS. Absent → Web Speech API is used instead.
  openAiApiKey: 'openai-api-key'
} as const

export interface HotaruSettings {
  anthropicApiKey: string
  openAiApiKey?: string   // optional
}

export async function loadSettings(): Promise<Partial<HotaruSettings>> {
  const [anthropicApiKey, openAiApiKey] = await Promise.all([
    window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.anthropicApiKey),
    window.hotaru.keychainGet(KEYCHAIN_ACCOUNTS.openAiApiKey)
  ])
  return {
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(openAiApiKey    ? { openAiApiKey }    : {})
  }
}

export async function saveSettings(settings: HotaruSettings): Promise<void> {
  const ops: Promise<void>[] = [
    window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.anthropicApiKey, settings.anthropicApiKey)
  ]
  if (settings.openAiApiKey) {
    ops.push(window.hotaru.keychainSet(KEYCHAIN_ACCOUNTS.openAiApiKey, settings.openAiApiKey))
  }
  await Promise.all(ops)
}

// Only the Anthropic key is required — everything else degrades gracefully.
export async function areSettingsComplete(): Promise<boolean> {
  const settings = await loadSettings()
  return !!settings.anthropicApiKey
}

export async function clearSettings(): Promise<void> {
  await Promise.all(
    Object.values(KEYCHAIN_ACCOUNTS).map((account) => window.hotaru.keychainDelete(account))
  )
}
