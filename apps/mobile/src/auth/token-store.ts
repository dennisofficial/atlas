import * as SecureStore from 'expo-secure-store'

export interface ITokenStore {
  load: () => Promise<string | undefined>
  save: (token: string) => Promise<void>
  clear: () => Promise<void>
}

const tokenKey = 'atlas.bearer'

export const createTokenStore = (): ITokenStore => ({
  load: async () => (await SecureStore.getItemAsync(tokenKey)) ?? undefined,
  save: async (token) => {
    await SecureStore.setItemAsync(tokenKey, token)
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(tokenKey)
  },
})
