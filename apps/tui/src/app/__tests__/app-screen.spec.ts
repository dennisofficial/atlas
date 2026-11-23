import { describe, expect, test } from 'bun:test'

import type { ThreadRow } from '../../ui/threads-model'
import {
  EScreen,
  screenOfAccount,
  screenOnAuthLost,
  screenOnBack,
  screenOnPick,
} from '../app-screen'
import { ACCOUNT_FILE_VERSION, type AccountFile } from '../account/account-file'

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: 'https://api.example.test',
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

const ROW: ThreadRow = {
  threadId: 'session-1',
  label: 'Fix the flaky test',
  titled: true,
  updatedAt: '2026-11-01T00:00:00.000Z',
  active: false,
}

describe('screenOfAccount', () => {
  test('sends a signed-out boot to sign-in with no reason', () => {
    expect(screenOfAccount({ account: null })).toEqual({ screen: EScreen.SignIn, reason: null })
  })

  test('sends a signed-in boot to the list', () => {
    expect(screenOfAccount({ account: ACCOUNT })).toEqual({ screen: EScreen.Sessions })
  })
})

describe('screenOnAuthLost', () => {
  test('a 401 sends the operator back to sign-in', () => {
    expect(screenOnAuthLost({ status: 401, email: 'dennis@example.test' })).toEqual({
      screen: EScreen.SignIn,
      reason: 'your sign-in expired.',
    })
  })

  test('a 403 keeps the account and names whose it is', () => {
    expect(screenOnAuthLost({ status: 403, email: 'dennis@example.test' })).toEqual({
      screen: EScreen.AwaitingAccess,
      email: 'dennis@example.test',
    })
    expect(screenOnAuthLost({ status: 403, email: null })).toEqual({
      screen: EScreen.AwaitingAccess,
      email: null,
    })
  })
})

describe('screenOnPick and screenOnBack', () => {
  test('an untitled row opens without a title', () => {
    expect(screenOnPick({ row: ROW, model: null })).toEqual({
      screen: EScreen.Transcript,
      sessionId: 'session-1',
      title: 'Fix the flaky test',
      model: null,
    })
    expect(
      screenOnPick({ row: { ...ROW, titled: false, label: 'session-1' }, model: null }),
    ).toEqual({
      screen: EScreen.Transcript,
      sessionId: 'session-1',
      title: null,
      model: null,
    })
  })

  test('back returns to the list', () => {
    expect(screenOnBack()).toEqual({ screen: EScreen.Sessions })
  })
})
