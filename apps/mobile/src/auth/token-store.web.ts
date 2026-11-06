import type { IPendingRevokeStorage } from './revoke-queue'

export interface ITokenStore {
  load: () => Promise<string | undefined>
  save: (token: string) => Promise<void>
  clear: () => Promise<void>
}

const tokenKey = 'atlas.bearer'
const pendingKey = 'atlas.pending-auth'
const pendingRevokeKey = 'atlas.pending-revoke'

type WebStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const createTokenStore = (storage?: WebStorage): ITokenStore => {
  const store = (): WebStorage => storage ?? localStorage
  return {
    load: async () => store().getItem(tokenKey) ?? undefined,
    save: async (token) => {
      store().setItem(tokenKey, token)
    },
    clear: async () => {
      store().removeItem(tokenKey)
    },
  }
}

export const pendingAuthStorage = (storage?: WebStorage) => {
  const store = (): WebStorage => storage ?? sessionStorage
  return {
    load: () => store().getItem(pendingKey) ?? undefined,
    save: (pending: string) => {
      store().setItem(pendingKey, pending)
    },
    clear: () => {
      store().removeItem(pendingKey)
    },
  }
}

export const createPendingRevokeStorage = (storage?: WebStorage): IPendingRevokeStorage => {
  const store = (): WebStorage => storage ?? localStorage
  return {
    load: async () => store().getItem(pendingRevokeKey) ?? undefined,
    save: async (value) => {
      store().setItem(pendingRevokeKey, value)
    },
    clear: async () => {
      store().removeItem(pendingRevokeKey)
    },
  }
}
