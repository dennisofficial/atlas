import { describe, expect, it } from 'bun:test'

import {
  askingLogin,
  ESettingsLogin,
  failedLogin,
  finishingLogin,
  idleLogin,
  isSettlingLogin,
  promptingLogin,
  signedInLogin,
} from '../settings-login-model'

describe('the settings sign-in flow', () => {
  it('starts idle with nothing to show', () => {
    const state = idleLogin()

    expect(state.status).toBe(ESettingsLogin.Idle)
    expect(state.prompt).toBeNull()
    expect(state.failure).toBeNull()
    expect(state.notice).toBeNull()
  })

  it('asks before the ticket arrives, with no prompt yet', () => {
    const state = askingLogin()

    expect(state.status).toBe(ESettingsLogin.Asking)
    expect(state.prompt).toBeNull()
  })

  it('carries the code and URL once the ticket lands', () => {
    const state = promptingLogin({ url: 'http://localhost:3400/device', userCode: 'WXYZ-1234' })

    expect(state.status).toBe(ESettingsLogin.Prompting)
    expect(state.prompt).toEqual({ url: 'http://localhost:3400/device', userCode: 'WXYZ-1234' })
  })

  it('clears the prompt while the session is being finished', () => {
    const state = finishingLogin()

    expect(state.status).toBe(ESettingsLogin.Finishing)
    expect(state.prompt).toBeNull()
  })

  it('falls back to idle with a reason when it fails', () => {
    const state = failedLogin('that code expired.')

    expect(state.status).toBe(ESettingsLogin.Idle)
    expect(state.failure).toBe('that code expired.')
  })

  it('falls back to idle with a notice once signed in', () => {
    const state = signedInLogin('Signed in to Atlas Cloud as dennis@example.com.')

    expect(state.status).toBe(ESettingsLogin.Idle)
    expect(state.notice).toBe('Signed in to Atlas Cloud as dennis@example.com.')
  })

  it('is settling only while a flow is actually underway', () => {
    expect(isSettlingLogin(ESettingsLogin.Idle)).toBe(false)
    expect(isSettlingLogin(ESettingsLogin.Asking)).toBe(true)
    expect(isSettlingLogin(ESettingsLogin.Prompting)).toBe(true)
    expect(isSettlingLogin(ESettingsLogin.Finishing)).toBe(true)
  })
})
