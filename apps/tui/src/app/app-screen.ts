import type { ThreadRow } from '../ui/threads-model'
import type { AccountFile } from './account/account-file'
import type { AuthRefusal } from './session-client'

export enum EScreen {
  SignIn = 'sign-in',
  AwaitingAccess = 'awaiting-access',
  Sessions = 'sessions',
  Transcript = 'transcript',
}

export type ScreenState =
  | { screen: EScreen.SignIn; reason: string | null }
  | { screen: EScreen.AwaitingAccess; email: string | null }
  | { screen: EScreen.Sessions }
  | { screen: EScreen.Transcript; sessionId: string; title: string | null }

const EXPIRED = 'your sign-in expired.'

export const screenOfAccount = (args: { account: AccountFile | null }): ScreenState =>
  args.account === null ? { screen: EScreen.SignIn, reason: null } : { screen: EScreen.Sessions }

export const screenOnAuthLost = (args: {
  status: AuthRefusal
  email: string | null
}): ScreenState =>
  args.status === 403
    ? { screen: EScreen.AwaitingAccess, email: args.email }
    : { screen: EScreen.SignIn, reason: EXPIRED }

export const screenOnPick = (args: { row: ThreadRow }): ScreenState => ({
  screen: EScreen.Transcript,
  sessionId: args.row.threadId,
  title: args.row.titled ? args.row.label : null,
})

export const screenOnBack = (): ScreenState => ({ screen: EScreen.Sessions })
