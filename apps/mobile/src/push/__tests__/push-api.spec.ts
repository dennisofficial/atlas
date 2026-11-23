import { describe, expect, it } from 'bun:test'
import { ENotifyDeviceKind } from '@dltech/atlas-notifications'

import { expoDeviceOf } from '../push-api'

describe('expoDeviceOf', () => {
  it('registers the phone as an expo device of this install', () => {
    expect(
      expoDeviceOf({ token: 'ExponentPushToken[token-1]', clientId: 'install-1', label: 'iPhone' }),
    ).toEqual({
      kind: ENotifyDeviceKind.Expo,
      clientId: 'install-1',
      token: 'ExponentPushToken[token-1]',
      secret: null,
      label: 'iPhone',
    })
  })
})
