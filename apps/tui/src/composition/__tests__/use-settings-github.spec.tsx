import { afterEach, describe, expect, it } from 'bun:test'

import { settle } from '../../ui/markdown/__tests__/harness'
import { ESettingsLogin } from '../../ui/settings-login-model'
import {
  controlOf,
  expectUntil,
  githubCloud,
  mounted,
  remote,
  removeDirectory,
} from './use-settings-github-harness'

afterEach(removeDirectory)

describe('useSettingsGithub', () => {
  it('loads the stored connection on refresh', async () => {
    const state = remote()
    state.connected = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).connection?.login === 'octocat')
      expect(controlOf(probe).unreachable).toBe(false)
    } finally {
      await done()
    }
  })

  it('marks the row unreachable when the cloud cannot be reached', async () => {
    const state = remote()
    state.down = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).unreachable)
      expect(controlOf(probe).connection).toBeNull()
    } finally {
      await done()
    }
  })

  it('stays disconnected without a cloud session', async () => {
    const state = remote()
    const { probe, done } = await mounted({
      cloud: githubCloud({ state, signedIn: false }),
    })

    try {
      controlOf(probe).refresh()
      await settle(100)

      expect(controlOf(probe).connection).toBeNull()
      expect(controlOf(probe).unreachable).toBe(false)
    } finally {
      await done()
    }
  })

  it('runs the device flow and lands the connection', async () => {
    const state = remote()
    const { probe, opened, done } = await mounted({
      cloud: githubCloud({ state }),
    })

    try {
      controlOf(probe).activate()
      await expectUntil(() => controlOf(probe).flow.status === ESettingsLogin.Prompting)
      expect(controlOf(probe).flow.prompt?.userCode).toBe('ABCD-1234')
      expect(opened).toEqual(['https://github.com/login/device'])

      state.approved = true
      const notice = 'Connected GitHub as @octocat.'
      await expectUntil(() => controlOf(probe).flow.notice === notice)
      await expectUntil(() => controlOf(probe).connection?.login === 'octocat')
    } finally {
      controlOf(probe).stop()
      await done()
    }
  })

  it('stop cancels the poll', async () => {
    const state = remote()
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).activate()
      await expectUntil(() => controlOf(probe).flow.status === ESettingsLogin.Prompting)

      await expectUntil(() => state.polls >= 1)

      controlOf(probe).stop()
      await expectUntil(() => controlOf(probe).flow.status === ESettingsLogin.Idle)
      await settle(100)
      const pollsAtStop = state.polls
      await settle(300)

      expect(state.polls).toBe(pollsAtStop)
    } finally {
      await done()
    }
  })

  it('ends the flow with failure text when the connection is refused', async () => {
    const state = remote()
    state.denied = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).activate()
      await expectUntil(() => controlOf(probe).flow.status === ESettingsLogin.Prompting)
      await expectUntil(() => controlOf(probe).flow.failure !== null)
      expect(controlOf(probe).flow.failure).toBe('that connection was refused.')
    } finally {
      controlOf(probe).stop()
      await done()
    }
  })

  it('disconnects when activated while connected', async () => {
    const state = remote()
    state.connected = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).connection !== null)

      controlOf(probe).activate()
      await expectUntil(() => controlOf(probe).flow.notice === 'Disconnected GitHub.')
      await expectUntil(() => controlOf(probe).connection === null)
      expect(state.connected).toBe(false)
    } finally {
      await done()
    }
  })
})
