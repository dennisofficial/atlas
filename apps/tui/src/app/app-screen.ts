import type { SessionModelChoice } from '@dltech/atlas-protocol'

import type { ThreadRow } from '../ui/threads-model'
import type { AccountFile } from './account/account-file'
import type { AuthRefusal } from './session-client'

export enum EScreen {
  SignIn = 'sign-in',
  AwaitingAccess = 'awaiting-access',
  Sessions = 'sessions',
  Transcript = 'transcript',
  NewSession = 'new-session',
}

export type ScreenState =
  | { screen: EScreen.SignIn; reason: string | null }
  | { screen: EScreen.AwaitingAccess; email: string | null }
  | { screen: EScreen.Sessions }
  | {
      screen: EScreen.Transcript
      sessionId: string
      title: string | null
      model: SessionModelChoice | null
    }
  | { screen: EScreen.NewSession; model: SessionModelChoice | null }

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

export const screenOnNew = (args: { model: SessionModelChoice | null }): ScreenState => ({
  screen: EScreen.NewSession,
  model: args.model,
})

export const screenOnPick = (args: {
  row: ThreadRow
  model: SessionModelChoice | null
}): ScreenState => ({
  screen: EScreen.Transcript,
  sessionId: args.row.threadId,
  title: args.row.titled ? args.row.label : null,
  model: args.model,
})

export const screenOnCreated = (args: {
  sessionId: string
  model: SessionModelChoice | null
}): ScreenState => ({
  screen: EScreen.Transcript,
  sessionId: args.sessionId,
  title: null,
  model: args.model,
})

export const screenOnBack = (): ScreenState => ({ screen: EScreen.Sessions })

export type OpenSession = {
  sessionId: string
  title: string | null
  model: SessionModelChoice | null
}

const screenOfOpen = (opened: OpenSession): ScreenState => ({
  screen: EScreen.Transcript,
  sessionId: opened.sessionId,
  title: opened.title,
  model: opened.model,
})

export const screenOnTeammate = (args: { teammate: OpenSession }): ScreenState =>
  screenOfOpen(args.teammate)

export const screenOnReturn = (args: { back: OpenSession }): ScreenState => screenOfOpen(args.back)
