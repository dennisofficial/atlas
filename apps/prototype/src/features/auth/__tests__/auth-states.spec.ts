import { describe, expect, test } from 'bun:test'

import { parseControls } from '@/proto/use-prototype'

import { formatDeviceCode } from '../auth-format'
import { AUTH_PATHS, deviceStepHref, signInHref, withState } from '../auth-paths'
import { EDeviceStep, ESignInContext, ESignInState, parseEnum, selectOf } from '../auth-states'

describe('selectOf', () => {
  test('lists every enum value and defaults to the fallback', () => {
    const control = selectOf({
      label: 'Step',
      values: EDeviceStep,
      fallback: EDeviceStep.EnterCode,
    })
    expect(control.options).toEqual([
      'enter-code',
      'confirm',
      'confirm-busy',
      'approved',
      'denied',
      'expired-code',
      'signed-out',
    ])
    expect(control.default).toBe('enter-code')
  })

  test('feeds parseControls so a url value selects the state', () => {
    const controls = {
      state: selectOf({ label: 'State', values: ESignInState, fallback: ESignInState.Idle }),
      context: selectOf({
        label: 'Context',
        values: ESignInContext,
        fallback: ESignInContext.Default,
      }),
    }
    const values = parseControls({
      controls,
      params: new URLSearchParams('state=google-error&context=device'),
    })
    expect(values).toEqual({ state: 'google-error', context: 'device' })
  })
})

describe('parseEnum', () => {
  test('returns the matching member, else the fallback', () => {
    const fallback = ESignInState.Idle
    expect(parseEnum({ values: ESignInState, raw: 'busy', fallback })).toBe(ESignInState.Busy)
    expect(parseEnum({ values: ESignInState, raw: 'nope', fallback })).toBe(fallback)
  })
})

describe('auth paths', () => {
  test('build urls the routes read back', () => {
    expect(withState({ path: AUTH_PATHS.reset, state: 'success' })).toBe(
      '/reset-password?state=success',
    )
    expect(deviceStepHref({ step: EDeviceStep.Confirm, code: 'ABCD-1234' })).toBe(
      '/device?step=confirm&user_code=ABCD-1234',
    )
    expect(deviceStepHref({ step: EDeviceStep.Denied })).toBe('/device?step=denied')
    expect(signInHref(ESignInContext.Device)).toBe('/sign-in?context=device')
  })
})

describe('auth format', () => {
  test('device code formatting', () => {
    expect(formatDeviceCode('wdjbmjht')).toBe('WDJB-MJHT')
    expect(formatDeviceCode('wd')).toBe('WD')
  })
})
