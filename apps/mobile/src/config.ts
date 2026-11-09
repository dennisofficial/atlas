import Constants from 'expo-constants'

interface IAppExtra {
  apiOrigin?: string
  webOrigin?: string
}

const extra = (Constants.expoConfig?.extra ?? {}) as IAppExtra

export const apiOrigin = (
  process.env.EXPO_PUBLIC_API_ORIGIN ??
  extra.apiOrigin ??
  'https://api.byatlas.io'
).replace(/\/+$/, '')

export const webOrigin = (
  process.env.EXPO_PUBLIC_WEB_ORIGIN ??
  extra.webOrigin ??
  'https://byatlas.io'
).replace(/\/+$/, '')

export const streamUrl = process.env.EXPO_PUBLIC_STREAM_URL ?? 'wss://agent.byatlas.io/stream'

export const nativeRedirectUri = 'atlas://auth/callback'
