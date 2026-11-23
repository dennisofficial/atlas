import { randomUUID } from 'expo-crypto'

import { kvJsonStore } from './kv-json-store'

const CLIENT_DATABASE = 'atlas-client'

const CLIENT_ID_NAME = 'clientId'

export const installClientId = async (): Promise<string> => {
  const store = kvJsonStore({ database: CLIENT_DATABASE })
  const stored = await store.read(CLIENT_ID_NAME)
  if (typeof stored === 'string' && stored.length > 0) return stored
  const clientId = randomUUID()
  await store.write(CLIENT_ID_NAME, clientId)
  return clientId
}
