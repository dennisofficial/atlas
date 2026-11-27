import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { frameShowing } from '../../ui/__tests__/waiting'
import { readAccount } from '../account/account-file'
import type { LoginExchange } from '../account/login-exchange'
import type { LoopbackStarter } from '../account/use-sign-in'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const WEB = 'https://byatlas.io'

const EMAIL = 'dennis@example.test'

const USER_CODE = 'ABCD-1234'

const VERIFY_URL = 'https://byatlas.io/device?code=ABCD-1234'

const WITHIN = 30_000

const START = 'Sign in to Atlas Cloud from this terminal.'

const fakeCreateClient: SessionClientFactory = (args) =>
  fakeSessionClient({ onAuthLost: args.onAuthLost })

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const challengeOf = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url')

const fakeFetch = (): typeof fetch =>
  (async (input: Parameters<typeof fetch>[0]) => {
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

    if (url.endsWith('/api/auth/device/token'))
      return json({ access_token: 'token-1', token_type: 'Bearer' })

    if (url.endsWith('/api/auth/get-session')) return json({ user: { email: EMAIL, name: null } })

    return new Response('', { status: 404 })
  }) as typeof fetch

const renderSignIn = async (args: {
  accountPath: string
  opened: string[]
  exchange?: LoginExchange | undefined
  startLoopbackWait?: LoopbackStarter | undefined
}) =>
  testRender(
    <AppNext
      accountPath={args.accountPath}
      initialAccount={null}
      apiUrl={API_URL}
      clientVersion="test"
      webOrigin={WEB}
      env={{}}
      platform="darwin"
      openUrl={(url) => args.opened.push(url)}
      fetchFn={fakeFetch()}
      {...(args.exchange === undefined ? {} : { exchangeLogin: args.exchange })}
      {...(args.startLoopbackWait === undefined
        ? {}
        : { startLoopbackWait: args.startLoopbackWait })}
      createClient={fakeCreateClient}
      onQuit={() => undefined}
    />,
    { width: 100, height: 30 },
  )

const accountPathIn = (): string =>
  join(mkdtempSync(join(tmpdir(), 'atlas-loopback-')), 'account.json')

describe('signing in through the loopback', () => {
  test(
    'opens the browser page, takes the code back and exchanges it',
    async () => {
      const accountPath = accountPathIn()
      const opened: string[] = []
      const exchanged: Parameters<LoginExchange>[0][] = []
      const exchange: LoginExchange = async (login) => {
        exchanged.push(login)
        return 'token-1'
      }
      const setup = await renderSignIn({ accountPath, opened, exchange })

      try {
        await frameShowing({ setup, text: START })
        setup.mockInput.pressEnter()
        await frameShowing({ setup, text: 'waiting for your browser…', within: WITHIN })

        const authorize = new URL(opened[0] ?? '')
        expect(authorize.origin).toBe(WEB)
        expect(authorize.pathname).toBe('/desktop/authorize')
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
        const state = authorize.searchParams.get('state') ?? ''
        const redirectUri = authorize.searchParams.get('redirect_uri') ?? ''
        expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d{1,5}\/desktop\/auth\/callback$/)

        const returned = await fetch(`${redirectUri}?code=code-1&state=${state}`)
        expect(returned.status).toBe(200)
        expect(await returned.text()).toContain('Signed in to Atlas.')

        await frameShowing({ setup, text: 'CONVERSATIONS', within: WITHIN })

        expect(exchanged).toHaveLength(1)
        const login = exchanged[0]
        expect(login?.code).toBe('code-1')
        expect(login?.redirectUri).toBe(redirectUri)
        expect(challengeOf(login?.codeVerifier ?? '')).toBe(
          authorize.searchParams.get('code_challenge') ?? '',
        )
        expect(readAccount({ path: accountPath })?.token).toBe('token-1')
      } finally {
        await teardown(setup)
      }
    },
    WITHIN,
  )

  test(
    'keeps waiting for a return that names another state',
    async () => {
      const opened: string[] = []
      const exchanged: Parameters<LoginExchange>[0][] = []
      const exchange: LoginExchange = async (login) => {
        exchanged.push(login)
        return 'token-1'
      }
      const setup = await renderSignIn({ accountPath: accountPathIn(), opened, exchange })

      try {
        await frameShowing({ setup, text: START })
        setup.mockInput.pressEnter()
        await frameShowing({ setup, text: 'waiting for your browser…', within: WITHIN })

        const authorize = new URL(opened[0] ?? '')
        const redirectUri = authorize.searchParams.get('redirect_uri') ?? ''
        const stranger = await fetch(`${redirectUri}?code=code-1&state=another-state`)
        expect(stranger.status).toBe(404)

        await frameShowing({ setup, text: 'waiting for your browser…', within: WITHIN })
        expect(exchanged).toEqual([])
      } finally {
        await teardown(setup)
      }
    },
    WITHIN,
  )

  test(
    'falls back to a device code when the listener cannot bind',
    async () => {
      const opened: string[] = []
      const setup = await renderSignIn({
        accountPath: accountPathIn(),
        opened,
        startLoopbackWait: () => {
          throw new Error('the loopback bound no port')
        },
      })

      try {
        await frameShowing({ setup, text: START })
        setup.mockInput.pressEnter()

        const prompted = await frameShowing({ setup, text: USER_CODE, within: WITHIN })
        expect(prompted).toContain(VERIFY_URL)
        expect(opened).toEqual([VERIFY_URL])
      } finally {
        await teardown(setup)
      }
    },
    WITHIN,
  )

  test(
    'offers a code instead while the browser is open',
    async () => {
      const opened: string[] = []
      const setup = await renderSignIn({ accountPath: accountPathIn(), opened })

      try {
        await frameShowing({ setup, text: START })
        setup.mockInput.pressEnter()
        const waiting = await frameShowing({
          setup,
          text: 'waiting for your browser…',
          within: WITHIN,
        })
        expect(waiting).toContain('press c to use a code instead')

        setup.mockInput.pressKey('c')

        const prompted = await frameShowing({ setup, text: USER_CODE, within: WITHIN })
        expect(prompted).toContain(VERIFY_URL)
      } finally {
        await teardown(setup)
      }
    },
    WITHIN,
  )
})
