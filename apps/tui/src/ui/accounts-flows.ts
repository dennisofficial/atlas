import { ELoginFlow, providerSpec, type EAuthProvider } from '@dltech/atlas-core'

export const acceptsApiKey = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.ApiKey)

export const acceptsBrowserLogin = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.BrowserCode)

export const acceptsPastedCode = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.PastedCode)

export const acceptsDeviceCode = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.DeviceCode)
