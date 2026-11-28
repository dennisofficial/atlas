import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import { describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { GithubPollResult } from '../session-api'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import { EReturnResult } from '@dltech/atlas-core'
import { ESettingsLogin } from '../../ui/settings-login-model'
import { useGithubConnect, type GithubControl } from '../use-github-connect'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let sequence = 0
const mount = async (env: Record<string, string | undefined>) => {
  const state = `github-tui-${++sequence}`
  const url = `https://api.byatlas.io/return/start/${state}`
  let devices = 0
  let redirects = 0
  let opened = ''
  let stopped = 0
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  let control: GithubControl | undefined
  const api = {
    githubState: async () => ({ connected: false as const }),
    beginGithubRedirect: async () => {
      redirects++
      return { url }
    },
    beginGithubConnect: async () => {
      devices++
      return {
        deviceCode: 'device',
        userCode: 'ABCD',
        verificationUrl: 'https://github.com/login/device',
        expiresInMs: 60_000,
        intervalMs: 30_000,
      }
    },
    pollGithubConnect: async () => ({ status: 'pending' }) as GithubPollResult,
    disconnectGithub: async () => {},
  }
  const opener = {
    open: (args: { url: string }) => {
      opened = args.url
    },
    stop: () => {
      stopped++
    },
  }
  function Probe() {
    control = useGithubConnect({ api, openUrl: () => {}, env, platform: 'linux', opener })
    return <text>{control.flow.status}</text>
  }
  await act(async () => {
    root.render(<Probe />)
    await setup.flush()
  })
  const current = () => {
    if (control === undefined) throw new Error('no control')
    return control
  }
  return {
    state,
    current,
    devices: () => devices,
    redirects: () => redirects,
    opened: () => opened,
    stopped: () => stopped,
    run: async (work: () => void) =>
      act(async () => {
        work()
        await setup.flush()
      }),
    close: async () => {
      await act(async () => root.unmount())
      setup.renderer.destroy()
    },
  }
}

describe('GitHub TUI browser connect', () => {
  it('uses the browser locally and refreshes when the framework returns', async () => {
    const rig = await mount({ DISPLAY: ':0' })
    try {
      await rig.run(() => rig.current().onActivate())
      expect(rig.redirects()).toBe(1)
      expect(rig.devices()).toBe(0)
      expect(rig.opened()).toContain('/return/start/')
      expect(rig.current().flow.status).toBe(ESettingsLogin.Browser)
      await rig.run(() =>
        browserReturns.remember({ state: rig.state, outcome: { result: EReturnResult.Connected } }),
      )
      expect(rig.current().flow.notice).toContain('Connected GitHub')
    } finally {
      await rig.close()
    }
  })
  it('keeps the device flow for SSH and headless sessions', async () => {
    for (const env of [{ SSH_CONNECTION: 'ssh' }, {}]) {
      const rig = await mount(env)
      try {
        await rig.run(() => rig.current().onActivate())
        expect(rig.devices()).toBe(1)
        expect(rig.redirects()).toBe(0)
        expect(rig.current().flow.prompt?.userCode).toBe('ABCD')
      } finally {
        await rig.close()
      }
    }
  })
  it('switches a local browser wait to a code and ignores its stale return', async () => {
    const rig = await mount({ DISPLAY: ':0' })
    try {
      await rig.run(() => rig.current().onActivate())
      await rig.run(() => rig.current().onActivate())
      expect(rig.devices()).toBe(1)
      await rig.run(() =>
        browserReturns.remember({ state: rig.state, outcome: { result: EReturnResult.Connected } }),
      )
      expect(rig.current().flow.status).toBe(ESettingsLogin.Prompting)
    } finally {
      await rig.close()
    }
  })
})
