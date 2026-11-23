const CLIENT_ID_KEY = 'atlas.client-id'

const minted = (): string => crypto.randomUUID()

export function installClientId(storage?: Storage): string {
  const store = storage ?? window.localStorage
  try {
    const existing = store.getItem(CLIENT_ID_KEY)
    if (existing !== null && existing.length > 0) return existing
    const clientId = minted()
    store.setItem(CLIENT_ID_KEY, clientId)
    return clientId
  } catch {
    return minted()
  }
}
