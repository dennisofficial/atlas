export enum ESettingsLogin {
  Idle = 'idle',
  Asking = 'asking',
  Prompting = 'prompting',
  Finishing = 'finishing',
}

export type SettingsLoginPrompt = { url: string; userCode: string }

export type SettingsLoginState = {
  status: ESettingsLogin
  prompt: SettingsLoginPrompt | null
  failure: string | null
  notice: string | null
}

export const idleLogin = (): SettingsLoginState => ({
  status: ESettingsLogin.Idle,
  prompt: null,
  failure: null,
  notice: null,
})

export const askingLogin = (): SettingsLoginState => ({
  status: ESettingsLogin.Asking,
  prompt: null,
  failure: null,
  notice: null,
})

export const promptingLogin = (prompt: SettingsLoginPrompt): SettingsLoginState => ({
  status: ESettingsLogin.Prompting,
  prompt,
  failure: null,
  notice: null,
})

export const finishingLogin = (): SettingsLoginState => ({
  status: ESettingsLogin.Finishing,
  prompt: null,
  failure: null,
  notice: null,
})

export const failedLogin = (reason: string): SettingsLoginState => ({ ...idleLogin(), failure: reason })

export const signedInLogin = (notice: string): SettingsLoginState => ({ ...idleLogin(), notice })

export const isSettlingLogin = (status: ESettingsLogin): boolean =>
  status === ESettingsLogin.Asking ||
  status === ESettingsLogin.Prompting ||
  status === ESettingsLogin.Finishing
