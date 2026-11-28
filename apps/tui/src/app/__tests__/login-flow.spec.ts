import { describe, expect, it } from 'bun:test'

import { ELoginFlow, loginFlowOf } from '../account/login-flow'

const flowOf = (args: { env: Record<string, string | undefined>; platform: string }): ELoginFlow =>
  loginFlowOf(args)

describe('the login flow a terminal can run', () => {
  it('opens a loopback browser on a desktop session', () => {
    expect(flowOf({ env: {}, platform: 'darwin' })).toBe(ELoginFlow.Loopback)
    expect(flowOf({ env: { DISPLAY: ':0' }, platform: 'linux' })).toBe(ELoginFlow.Loopback)
    expect(flowOf({ env: { WAYLAND_DISPLAY: 'wayland-0' }, platform: 'linux' })).toBe(
      ELoginFlow.Loopback,
    )
  })

  it('uses a device code over ssh, on a headless linux or with an empty variable', () => {
    expect(
      flowOf({ env: { SSH_CONNECTION: '10.0.0.1 51000 10.0.0.2 22' }, platform: 'darwin' }),
    ).toBe(ELoginFlow.DeviceCode)
    expect(flowOf({ env: { SSH_TTY: '/dev/pts/1' }, platform: 'darwin' })).toBe(
      ELoginFlow.DeviceCode,
    )
    expect(flowOf({ env: {}, platform: 'linux' })).toBe(ELoginFlow.DeviceCode)
    expect(flowOf({ env: { SSH_CONNECTION: '' }, platform: 'darwin' })).toBe(ELoginFlow.Loopback)
  })
})
