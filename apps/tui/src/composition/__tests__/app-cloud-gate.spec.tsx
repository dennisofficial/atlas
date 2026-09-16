import { describe, expect, it } from 'bun:test'

import { SecretsPort } from '@dltech/atlas-core'
import { CloudSignInRequiredError } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { open, until, REPLY, THINKING } from './app-fixture'
import { fakeApp, fakeSignedOutCloud, failingModelPort, scriptedModelPort } from './fake-app'

await grammarsReady()

const SIGN_IN_NOTICE = 'Sign in to Atlas Cloud to use Atlas.'

const SIGN_IN_REQUIRED = 'sign in to Atlas Cloud first — /auth'

const scripted = () => scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } })

describe('the cloud sign-in boot gate', () => {
  it('leaves a signed-out boot alone while the cloud stays optional', async () => {
    const mounted = await open({
      app: fakeApp({ model: scripted(), cloud: fakeSignedOutCloud() }),
    })

    try {
      const frame = await mounted.frame()
      expect(frame).toContain('Describe the work')
      expect(frame).not.toContain('ACCOUNTS')
      expect(frame).not.toContain(SIGN_IN_NOTICE)
      expect(mounted.app.openedUrls).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('leaves a signed-in boot alone even when the cloud is required', async () => {
    const mounted = await open({
      app: fakeApp({ model: scripted(), cloudRequired: true }),
    })

    try {
      const frame = await mounted.frame()
      expect(frame).toContain('Describe the work')
      expect(frame).not.toContain('ACCOUNTS')
      expect(frame).not.toContain(SIGN_IN_NOTICE)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('opens the accounts overlay on the Atlas Cloud row when the cloud is required and there is no session', async () => {
    const mounted = await open({
      app: fakeApp({ model: scripted(), cloud: fakeSignedOutCloud(), cloudRequired: true }),
    })

    try {
      const gated = await until({
        holds: async () => (await mounted.frame()).includes(SIGN_IN_NOTICE),
        within: 20_000,
      })
      expect(gated).toBe(true)

      const frame = await mounted.frame()
      expect(frame).toContain('ACCOUNTS')
      expect(frame).toContain('not signed in · sign in')
      expect(frame.indexOf('Atlas Cloud')).toBeLessThan(frame.indexOf('Anthropic'))
      expect(mounted.app.openedUrls).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('fires once — a dismissed gate stays dismissed as the app keeps rendering', async () => {
    const mounted = await open({
      app: fakeApp({ model: scripted(), cloud: fakeSignedOutCloud(), cloudRequired: true }),
    })

    try {
      const gated = await until({
        holds: async () => (await mounted.frame()).includes('ACCOUNTS'),
        within: 20_000,
      })
      expect(gated).toBe(true)

      mounted.pressEscape()

      const closed = await until({
        holds: async () => !(await mounted.frame()).includes('ACCOUNTS'),
        within: 20_000,
      })
      expect(closed).toBe(true)

      await mounted.typeText('still here')
      expect(await mounted.frame()).not.toContain('ACCOUNTS')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('renders the gate over a secrets port that reads empty and refuses writes, like a signed-out proxy', async () => {
    class SignedOutSecrets extends SecretsPort {
      origin(): string {
        return 'Atlas Cloud (signed out)'
      }
      read(): string | undefined {
        return undefined
      }
      write(): void {
        throw new CloudSignInRequiredError()
      }
      remove(): void {
        throw new CloudSignInRequiredError()
      }
    }

    const mounted = await open({
      app: fakeApp({
        model: scripted(),
        cloud: fakeSignedOutCloud(),
        cloudRequired: true,
        secretsPort: new SignedOutSecrets(),
      }),
    })

    try {
      const gated = await until({
        holds: async () => (await mounted.frame()).includes(SIGN_IN_NOTICE),
        within: 20_000,
      })
      expect(gated).toBe(true)
      expect(await mounted.frame()).not.toContain('something broke')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows the sign-in refusal verbatim when a prompt is sent while signed out', async () => {
    const mounted = await open({
      app: fakeApp({
        model: failingModelPort({ message: SIGN_IN_REQUIRED }),
        cloud: fakeSignedOutCloud(),
        cloudRequired: true,
      }),
    })

    try {
      await until({
        holds: async () => (await mounted.frame()).includes('ACCOUNTS'),
        within: 20_000,
      })
      mounted.pressEscape()
      await until({
        holds: async () => !(await mounted.frame()).includes('ACCOUNTS'),
        within: 20_000,
      })

      await mounted.typeText('what changed?')
      mounted.pressEnter()

      const blamed = await until({
        holds: async () => (await mounted.frame()).includes(SIGN_IN_REQUIRED),
        within: 20_000,
      })
      expect(blamed).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
