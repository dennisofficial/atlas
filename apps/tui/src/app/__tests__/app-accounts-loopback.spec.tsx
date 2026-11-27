import { describe, expect, test } from 'bun:test'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import type { ProviderSignInBegin } from '../session-api'
import { openApp as open, openDrawer, resetPaletteAfterEach, WITHIN } from './app-accounts-fixture'

resetPaletteAfterEach()

describe('the accounts drawer browser sign-in', () => {
  test('anthropic signs in through a browser loopback when the machine has one', async () => {
    const mounted = await open({
      env: {},
      platform: 'darwin',
      configure: (client) => {
        client.setProviderSignIn({
          flow: 'loopback',
          attemptId: 'attempt-loop',
          authorizeUrl: 'https://auth.example.test/anthropic-loopback',
          state: 'state-loop',
          expiresInMs: 600_000,
        } as ProviderSignInBegin)
      },
    })

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Sign in', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({ setup: mounted.setup, text: 'waiting for the browser', within: WITHIN })

      const asked = mounted.client().calls.beginProviderSignIn[0]
      expect(String(asked?.flow)).toBe('loopback')
      const redirectUri = new URL(String(asked?.redirectUri))
      expect(redirectUri.hostname).toBe('localhost')
      expect(redirectUri.pathname).toBe('/callback')
      expect(mounted.opened).toContain('https://auth.example.test/anthropic-loopback')

      await fetch(`${redirectUri.origin}/callback?code=loop-code&state=state-loop`)

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client().calls.completeProviderSignIn.length === 1,
        within: WITHIN,
        describe: 'the loopback code to be submitted',
      })
      expect(mounted.client().calls.completeProviderSignIn[0]).toEqual({
        attemptId: 'attempt-loop',
        code: 'loop-code',
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('anthropic signs in by pasting the code', async () => {
    const mounted = await open()

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Sign in', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({
        setup: mounted.setup,
        text: 'auth.example.test/anthropic',
        within: WITHIN,
      })
      expect(String(mounted.client().calls.beginProviderSignIn[0]?.provider)).toBe('anthropic')
      expect(mounted.client().calls.beginProviderSignIn[0]?.flow).toBeUndefined()
      expect(mounted.opened).toContain('https://auth.example.test/anthropic')

      await mounted.setup.mockInput.typeText('the-code')
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client().calls.completeProviderSignIn.length === 1,
        within: WITHIN,
        describe: 'the pasted code to be submitted',
      })
      expect(mounted.client().calls.completeProviderSignIn[0]).toEqual({
        attemptId: 'attempt-1',
        code: 'the-code',
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
