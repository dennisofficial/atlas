import { describe, expect, test } from 'bun:test'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import type { ProviderSignInBegin, ProviderSignInPoll } from '../session-api'
import { openApp as open, openDrawer, resetPaletteAfterEach, WITHIN } from './app-accounts-fixture'
import { accountRowOf } from './fake-session-client'

resetPaletteAfterEach()

const TWO_LOGINS = [
  accountRowOf({ id: 'account-1', provider: 'anthropic', label: 'first login' }),
  accountRowOf({ id: 'account-2', provider: 'anthropic', label: 'second login' }),
]

describe('the accounts drawer', () => {
  test('ctrl+a opens it, and every provider reads not signed in with no logins', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      const frame = mounted.setup.captureCharFrame()
      expect(frame).toContain('Anthropic')
      expect(frame).toContain('OpenAI')
      expect(frame).toContain('○ not signed in')
      expect(mounted.client().calls.accounts).toBeGreaterThan(0)
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('openai signs in with a device code and the code is polled', async () => {
    const mounted = await open({
      configure: (client) => {
        client.setProviderSignIn({
          flow: 'device-code',
          attemptId: 'attempt-2',
          userCode: 'abcd-1234',
          verificationUrl: 'https://device.example.test',
          intervalMs: 1,
          expiresInMs: 600_000,
        } as ProviderSignInBegin)
        client.queueSignInPoll([
          {
            status: 'complete',
            account: accountRowOf({ id: 'account-openai', provider: 'openai', label: 'My OpenAI' }),
          } as ProviderSignInPoll,
        ])
      },
    })

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Sign in', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({ setup: mounted.setup, text: 'abcd-1234', within: WITHIN })
      expect(String(mounted.client().calls.beginProviderSignIn[0]?.provider)).toBe('openai')

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client().calls.pollProviderSignIn.length > 0,
        within: WITHIN,
        describe: 'the device code to be polled',
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('an api key is saved as a provider account', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Sign in', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'waiting for a paste', within: WITHIN })

      await mounted.setup.mockInput.typeText('sk-ant-1234')
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client().calls.createAccount.length === 1,
        within: WITHIN,
        describe: 'the api key to be saved',
      })
      const body = mounted.client().calls.createAccount[0]
      expect(String(body?.provider)).toBe('anthropic')
      expect(String(body?.origin)).toBe('login')
      expect(body?.label).toBe('Key saved')
      expect(String(body?.secret.kind)).toBe('api-key')
      expect(body?.secret.apiKey).toBe('sk-ant-1234')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('switching the active login records the new one', async () => {
    const mounted = await open({
      configure: (client) => {
        client.setAccounts(TWO_LOGINS)
        client.setActiveAccountId({ provider: 'anthropic', accountId: 'account-1' })
      },
    })

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Switch active login', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'second login', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client().calls.setActiveAccount.length === 1,
        within: WITHIN,
        describe: 'the active login to change',
      })
      expect(mounted.client().calls.setActiveAccount[0]?.accountId).toBe('account-2')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('removing a login records the removal', async () => {
    const mounted = await open({
      configure: (client) => {
        client.setAccounts(TWO_LOGINS)
        client.setActiveAccountId({ provider: 'anthropic', accountId: 'account-1' })
      },
    })

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Remove a login', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'second login', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client().calls.removeAccount.length === 1,
        within: WITHIN,
        describe: 'the login to be removed',
      })
      expect(mounted.client().calls.removeAccount[0]?.accountId).toBe('account-2')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
