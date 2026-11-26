import { describe, expect, it } from 'bun:test'

import type { IPushApi } from '../push-api'
import { EPushRegistrationStatus, EPushSkipReason, EPushStep } from '../push-registration'
import { PUSH_DEVICE_LABEL, registerPushDevice } from '../register-push'

const never = <T>(): Promise<T> => new Promise<T>(() => undefined)

const pushApiOf = (register: IPushApi['register']): IPushApi & { calls: unknown[] } => {
  const calls: unknown[] = []
  return {
    calls,
    register: (input) => {
      calls.push(input)
      return register(input)
    },
    unregister: async () => undefined,
    sendTest: async () => ({ devices: 0 }),
  }
}

describe('registerPushDevice', () => {
  it('registers the expo token of this install', async () => {
    const pushApi = pushApiOf(async () => ({ id: 'device-1' }))
    const result = await registerPushDevice({
      pushApi,
      clientId: async () => 'install-1',
      pushToken: async () => ({ status: 'ok', token: 'ExponentPushToken[a]' }),
    })
    expect(result).toEqual({ status: EPushRegistrationStatus.Registered, deviceId: 'device-1' })
    expect(pushApi.calls).toEqual([
      { token: 'ExponentPushToken[a]', clientId: 'install-1', label: PUSH_DEVICE_LABEL },
    ])
  })

  it('reports a skip without calling the server', async () => {
    const pushApi = pushApiOf(async () => ({ id: 'device-1' }))
    const result = await registerPushDevice({
      pushApi,
      clientId: async () => 'install-1',
      pushToken: async () => ({ status: 'skipped', reason: EPushSkipReason.PermissionDenied }),
    })
    expect(result).toEqual({
      status: EPushRegistrationStatus.Skipped,
      reason: EPushSkipReason.PermissionDenied,
    })
    expect(pushApi.calls).toEqual([])
  })

  it('fails at the token step when the token request throws', async () => {
    const result = await registerPushDevice({
      pushApi: pushApiOf(async () => ({ id: 'device-1' })),
      clientId: async () => 'install-1',
      pushToken: () => {
        throw new Error('no valid aps-environment')
      },
    })
    expect(result).toEqual({
      status: EPushRegistrationStatus.Failed,
      step: EPushStep.Token,
      message: 'no valid aps-environment',
    })
  })

  it('fails at the token step when the token request never answers', async () => {
    const result = await registerPushDevice({
      pushApi: pushApiOf(async () => ({ id: 'device-1' })),
      clientId: async () => 'install-1',
      pushToken: never,
      timeoutMs: 5,
    })
    expect(result).toEqual({
      status: EPushRegistrationStatus.Failed,
      step: EPushStep.Token,
      message: 'no answer after 0.005 s',
    })
  })

  it('fails at the register step when the server rejects the device', async () => {
    const result = await registerPushDevice({
      pushApi: pushApiOf(async () => {
        throw new Error('UNAUTHORIZED')
      }),
      clientId: async () => 'install-1',
      pushToken: async () => ({ status: 'ok', token: 'ExponentPushToken[a]' }),
    })
    expect(result).toEqual({
      status: EPushRegistrationStatus.Failed,
      step: EPushStep.Register,
      message: 'UNAUTHORIZED',
    })
  })

  it('fails at the install step when the install id cannot be read', async () => {
    const result = await registerPushDevice({
      pushApi: pushApiOf(async () => ({ id: 'device-1' })),
      clientId: async () => {
        throw new Error('database locked')
      },
      pushToken: async () => ({ status: 'ok', token: 'ExponentPushToken[a]' }),
    })
    expect(result).toEqual({
      status: EPushRegistrationStatus.Failed,
      step: EPushStep.Install,
      message: 'database locked',
    })
  })
})
