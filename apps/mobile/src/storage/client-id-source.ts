import type { JsonStore } from './json-store'

const CLIENT_ID_NAME = 'clientId'

export const createClientIdSource = (args: {
  store: () => JsonStore
  newId: () => string
}): (() => Promise<string>) => {
  let pending: Promise<string> | undefined
  const readOrCreate = async (): Promise<string> => {
    const store = args.store()
    const stored = await store.read(CLIENT_ID_NAME)
    if (typeof stored === 'string' && stored.length > 0) return stored
    const clientId = args.newId()
    await store.write(CLIENT_ID_NAME, clientId)
    return clientId
  }
  return () => {
    pending ??= readOrCreate().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}
