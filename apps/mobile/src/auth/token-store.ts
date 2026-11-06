import * as SecureStore from 'expo-secure-store'

import type { IPendingRevokeStorage } from './revoke-queue'

export interface ITokenStore {
  load: () => Promise<string | undefined>
  save: (token: string) => Promise<void>
  clear: () => Promise<void>
}

const tokenKey = 'atlas.bearer'
const pendingRevokeKey = 'atlas.pending-revoke'

export const createTokenStore = (): ITokenStore => ({
  load: async () => (await SecureStore.getItemAsync(tokenKey)) ?? undefined,
  save: async (token) => {
    await SecureStore.setItemAsync(tokenKey, token)
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(tokenKey)
  },
})

export const createPendingRevokeStorage = (): IPendingRevokeStorage => ({
  load: async () => (await SecureStore.getItemAsync(pendingRevokeKey)) ?? undefined,
  save: async (value) => {
    await SecureStore.setItemAsync(pendingRevokeKey, value)
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(pendingRevokeKey)
  },
})
