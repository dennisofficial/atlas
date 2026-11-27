import { randomUUID } from 'expo-crypto'

import { createClientIdSource } from './client-id-source'
import { kvJsonStore } from './kv-json-store'

const CLIENT_DATABASE = 'atlas-client'

export const installClientId = createClientIdSource({
  store: () => kvJsonStore({ database: CLIENT_DATABASE }),
  newId: randomUUID,
})
