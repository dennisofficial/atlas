import { describe, expect, it } from 'bun:test'

import {
  EPushRegistrationStatus,
  EPushSkipReason,
  EPushStep,
  pushDeviceIdOf,
  pushRegistrationEventOf,
  pushRegistrationLabelOf,
  shouldRegisterOf,
  type TPushRegistration,
} from '../push-registration'

const registered: TPushRegistration = {
  status: EPushRegistrationStatus.Registered,
  deviceId: 'device-1',
}
const denied: TPushRegistration = {
  status: EPushRegistrationStatus.Skipped,
  reason: EPushSkipReason.PermissionDenied,
}
const simulator: TPushRegistration = {
  status: EPushRegistrationStatus.Skipped,
  reason: EPushSkipReason.NotDevice,
}
const tokenFailed: TPushRegistration = {
  status: EPushRegistrationStatus.Failed,
  step: EPushStep.Token,
  message: 'no answer after 20 s',
}

describe('pushRegistrationLabelOf', () => {
  it('names the outcome for the settings row', () => {
    expect(pushRegistrationLabelOf({ status: EPushRegistrationStatus.Idle })).toBe('Not registered')
    expect(pushRegistrationLabelOf({ status: EPushRegistrationStatus.Registering })).toBe(
      'Registering…',
    )
    expect(pushRegistrationLabelOf(registered)).toBe('Registered')
    expect(pushRegistrationLabelOf(denied)).toBe('Permission denied')
    expect(pushRegistrationLabelOf(tokenFailed)).toBe('Push token failed: no answer after 20 s')
  })
})

describe('shouldRegisterOf', () => {
  it('retries what can change and leaves the rest', () => {
    expect(shouldRegisterOf({ status: EPushRegistrationStatus.Idle })).toBe(true)
    expect(shouldRegisterOf(tokenFailed)).toBe(true)
    expect(shouldRegisterOf(denied)).toBe(true)
    expect(shouldRegisterOf(simulator)).toBe(false)
    expect(shouldRegisterOf(registered)).toBe(false)
    expect(shouldRegisterOf({ status: EPushRegistrationStatus.Registering })).toBe(false)
  })
})

describe('pushRegistrationEventOf', () => {
  it('captures only settled outcomes', () => {
    expect(pushRegistrationEventOf({ status: EPushRegistrationStatus.Registering })).toBeUndefined()
    expect(pushRegistrationEventOf(registered)).toEqual({ status: 'registered' })
    expect(pushRegistrationEventOf(denied)).toEqual({
      status: 'skipped',
      reason: 'permission-denied',
    })
    expect(pushRegistrationEventOf(tokenFailed)).toEqual({
      status: 'failed',
      step: 'token',
      message: 'no answer after 20 s',
    })
  })
})

describe('pushDeviceIdOf', () => {
  it('gives the device to unregister on sign-out', () => {
    expect(pushDeviceIdOf(registered)).toBe('device-1')
    expect(pushDeviceIdOf(tokenFailed)).toBeUndefined()
  })
})
