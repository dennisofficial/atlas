import { afterEach, describe, expect, it } from 'bun:test'

import { dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { open, until, REPLY, THINKING } from './app-fixture'
import { fakeApp, fakeSignedOutCloud, scriptedModelPort } from './fake-app'

await grammarsReady()

const SIGN_IN_NOTICE = 'sign in to Atlas Cloud to unlock cloud sandboxes and remote control'

const scripted = () => scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } })

afterEach(() => {
  dismissNotice()
})

describe('the cloud sign-in boot notice', () => {
  it('offers sign-in on a signed-out boot, without gating anything', async () => {
    const mounted = await open({
      app: fakeApp({ model: scripted(), cloud: fakeSignedOutCloud() }),
    })

    try {
      const found = await until({
        holds: async () => (await mounted.frame()).includes(SIGN_IN_NOTICE),
        within: 20_000,
      })
      expect(found).toBe(true)

      const frame = await mounted.frame()
      expect(frame).toContain('Describe the work')
      expect(frame).toContain('settings')
      expect(frame).toContain('account')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('says nothing on a signed-in boot', async () => {
    const mounted = await open({ app: fakeApp({ model: scripted() }) })

    try {
      const frame = await mounted.frame()
      expect(frame).not.toContain(SIGN_IN_NOTICE)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('fires once — it does not reappear as the app keeps rendering', async () => {
    const mounted = await open({
      app: fakeApp({ model: scripted(), cloud: fakeSignedOutCloud() }),
    })

    try {
      await until({
        holds: async () => (await mounted.frame()).includes(SIGN_IN_NOTICE),
        within: 20_000,
      })

      await mounted.typeText('still here')
      const frame = await mounted.frame()
      expect(frame.match(new RegExp(SIGN_IN_NOTICE, 'g'))).toHaveLength(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
