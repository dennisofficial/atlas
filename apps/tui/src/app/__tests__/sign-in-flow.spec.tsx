import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { readAccount } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const EMAIL = 'dennis@example.test'

const USER_CODE = 'ABCD-1234'

const VERIFY_URL = 'https://byatlas.io/device?code=ABCD-1234'

const WITHIN = 30_000

const SSH_ENV = { SSH_CONNECTION: '10.0.0.1 51000 10.0.0.2 22' }

const fakeCreateClient: SessionClientFactory = (args) =>
  fakeSessionClient({ onAuthLost: args.onAuthLost })

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const signInFetch = (): typeof fetch => {
  let polls = 0

  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)

    if (url.endsWith('/api/auth/device/code'))
      return json({
        device_code: 'device-1',
        user_code: USER_CODE,
        verification_uri: 'https://byatlas.io/device',
        verification_uri_complete: VERIFY_URL,
        expires_in: 600,
        interval: 1,
      })

    if (url.endsWith('/api/auth/device/token')) {
      polls += 1
      return polls === 1
        ? json({ error: 'authorization_pending' }, 400)
        : json({ access_token: 'token-1', token_type: 'Bearer' })
    }

    if (url.endsWith('/api/auth/get-session')) return json({ user: { email: EMAIL, name: null } })

    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('the sign-in flow', () => {
  test(
    'shows the device code over ssh, stores the token, then lists the account',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'atlas-sign-in-'))
      const accountPath = join(home, 'account.json')
      const opened: string[] = []

      const setup = await testRender(
        <AppNext
          accountPath={accountPath}
          initialAccount={null}
          apiUrl={API_URL}
          clientVersion="test"
          env={SSH_ENV}
          openUrl={(url) => opened.push(url)}
          fetchFn={signInFetch()}
          createClient={fakeCreateClient}
          onQuit={() => undefined}
        />,
        { width: 100, height: 30 },
      )

      try {
        await frameShowing({ setup, text: 'Sign in to Atlas Cloud from this terminal.' })

        setup.mockInput.pressEnter()
        const prompted = await frameShowing({ setup, text: USER_CODE, within: WITHIN })
        expect(prompted).toContain(VERIFY_URL)
        expect(opened).toEqual([VERIFY_URL])

        await frameShowing({ setup, text: 'CONVERSATIONS', within: WITHIN })

        expect(readAccount({ path: accountPath })).toEqual({
          version: 1,
          apiUrl: API_URL,
          email: EMAIL,
          token: 'token-1',
          preferences: {},
          lastSessionId: null,
        })
        expect(statSync(accountPath).mode & 0o777).toBe(0o600)
      } finally {
        await teardown(setup)
      }
    },
    WITHIN,
  )
})
