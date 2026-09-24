import { EAccountOrigin, EAuthKind, EAuthProvider, toThreadId } from '@dltech/atlas-core'
import {
  AccountsService,
  EDevicePoll,
  memoryAccountStore,
  SystemClock,
} from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { frameSettled, frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { until } from './app-fixture'
import { fakeApp, fakeSignedOutCloud, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const THREAD = toThreadId('opened-thread')

const WIDE = { width: 150, height: 40 }

type Mounted = Awaited<ReturnType<typeof testRender>>

const TOKEN_RESPONSE = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  account: { email_address: 'signed-in@example.com' },
}

const accountsHolding = async (labels: readonly string[]): Promise<AccountsService> => {
  const clock = new SystemClock()
  const store = memoryAccountStore({ clock })

  for (const label of labels) {
    await store.add({
      provider: EAuthProvider.Anthropic,
      label,
      origin: EAccountOrigin.Login,
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: `token-${label}`,
          refreshToken: 'refresh',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
    })
  }

  return new AccountsService({
    accounts: store,
    clients: {
      [EAuthProvider.Anthropic]: {
        generatePkce: () => ({ verifier: 'v', challenge: 'c', state: 'state-1' }),
        authorizeUrl: () => 'https://claude.com/cai/oauth/authorize?code=true',
        exchange: async () => ({
          tokens: {
            accessToken: TOKEN_RESPONSE.access_token,
            refreshToken: TOKEN_RESPONSE.refresh_token,
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          email: TOKEN_RESPONSE.account.email_address,
        }),
        refresh: async () => ({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      },
      [EAuthProvider.OpenAI]: {
        startDeviceLogin: async () => ({
          deviceAuthId: 'da-1',
          userCode: 'ABCD-EFGH',
          verificationUrl: 'https://auth.openai.com/codex/device',
          intervalMs: 100,
          expiresInMs: 900_000,
        }),
        pollDeviceLogin: async () => ({
          status: EDevicePoll.Complete,
          login: {
            tokens: {
              accessToken: 'openai-access',
              refreshToken: 'openai-refresh',
              expiresAt: '2099-01-01T00:00:00.000Z',
              accountId: 'acct-123',
            },
            email: 'codex-user@example.com',
            subscription: 'plus',
          },
        }),
        refresh: async () => ({
          accessToken: 'openai-access-2',
          refreshToken: 'openai-refresh-2',
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      },
    },
  })
}

const appWith = async (labels: readonly string[]): Promise<FakeApp> => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cloud: fakeSignedOutCloud(),
  })

  return { ...app, accounts: await accountsHolding(labels) }
}

async function opened(args: { app: FakeApp; notice?: string }): Promise<Mounted> {
  const setup = await testRender(
    <App
      app={args.app}
      opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }}
      credentialNotice={args.notice ?? null}
    />,
    WIDE,
  )
  await setup.flush()
  await frameSettled({ setup, within: 3000 })
  return setup
}

const openOverlay = async (setup: Mounted): Promise<void> => {
  setup.mockInput.pressKey('a', { ctrl: true })
  await setup.flush()
  await frameShowing({ setup, text: 'MODEL PROVIDERS' })
}

const down = async (setup: Mounted): Promise<void> => {
  setup.mockInput.pressArrow('down')
  await setup.flush()
  await frameSettled({ setup, within: 3000 })
}

const enter = async (setup: Mounted): Promise<void> => {
  setup.mockInput.pressEnter()
  await setup.flush()
  await frameSettled({ setup, within: 3000 })
}

describe('the accounts overlay', () => {
  it('opens on ctrl+a as the model provider list', async () => {
    const setup = await opened({ app: await appWith(['work@example.com', 'personal@example.com']) })

    try {
      await openOverlay(setup)

      const frame = await frameShowing({ setup, text: 'work@example.com' })

      expect(frame).toContain('MODEL PROVIDERS')
      expect(frame).toContain('work@example.com')
      expect(frame).toContain('personal@example.com')
    } finally {
      await teardown(setup)
    }
  })

  it('keeps GitHub out of the provider list even with a cloud session', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)

      const frame = await frameShowing({ setup, text: '○ not signed in' })
      expect(frame).not.toContain('GitHub')
    } finally {
      await teardown(setup)
    }
  })

  it('announces a boot auth failure as a chip rather than taking the screen', async () => {
    const setup = await opened({
      app: await appWith([]),
      notice: 'Atlas could not authenticate.\n\nAtlas holds no accounts. Sign in with /auth.',
    })

    try {
      const frame = await frameShowing({ setup, text: 'A provider login is failing' })

      expect(frame).toContain('A provider login is failing')
      expect(frame).toContain('ctrl+a')
      expect(frame).not.toContain('MODEL PROVIDERS')
    } finally {
      await teardown(setup)
    }
  })

  it('keeps the diagnosis for the first manual open the chip points at', async () => {
    const setup = await opened({
      app: await appWith([]),
      notice: 'Atlas could not authenticate.\n\nAtlas holds no accounts. Sign in with /auth.',
    })

    try {
      await openOverlay(setup)

      const frame = await frameShowing({ setup, text: 'Atlas holds no accounts' })

      expect(frame).toContain('MODEL PROVIDERS')
      expect(frame).toContain('Atlas holds no accounts')
    } finally {
      await teardown(setup)
    }
  })

  it('shows the chip only once for the same failure', async () => {
    const setup = await opened({
      app: await appWith([]),
      notice: 'Atlas could not authenticate.\n\nAtlas holds no accounts. Sign in with /auth.',
    })

    try {
      const first = await frameShowing({ setup, text: 'A provider login is failing' })
      expect(first.match(/A provider login is failing/g)).toHaveLength(1)
    } finally {
      await teardown(setup)
    }
  })

  it('opens from /auth as well as the chord', async () => {
    const setup = await opened({ app: await appWith(['work@example.com']) })

    try {
      await setup.mockInput.typeText('/auth')
      await setup.flush()
      setup.mockInput.pressEnter()
      await setup.flush()

      const frame = await frameShowing({ setup, text: 'MODEL PROVIDERS' })
      expect(frame).toContain('MODEL PROVIDERS')
    } finally {
      await teardown(setup)
    }
  })
})

describe('the actions modal', () => {
  it('opens on ⏎ over the selected provider', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)
      await enter(setup)

      const frame = await frameShowing({ setup, text: 'Sign in' })
      expect(frame).toContain('Sign in')
      expect(frame).toContain('Add an API key')
    } finally {
      await teardown(setup)
    }
  })

  it('offers only the api key for a provider with no browser flow', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)
      await down(setup)
      await down(setup)
      await enter(setup)

      const frame = await frameShowing({ setup, text: 'Add an API key' })
      expect(frame).toContain('Add an API key')
      expect(frame).not.toContain('Sign in')
    } finally {
      await teardown(setup)
    }
  })

  it('closes back to the list on escape', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)
      await enter(setup)
      await frameShowing({ setup, text: 'Add an API key' })
      setup.mockInput.pressEscape()
      await setup.flush()

      const frame = await frameWhen({
        setup,
        holds: (captured) => captured.includes('○ not signed in') && !captured.includes('Add an API key'),
        describe: 'the actions modal to close back to the list',
      })
      expect(frame).toContain('○ not signed in')
      expect(frame).not.toContain('Add an API key')
    } finally {
      await teardown(setup)
    }
  })
})

describe('the api key flow', () => {
  it('files the key under the provider whose actions were opened, not the first one', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)
      await down(setup)
      await down(setup)
      await enter(setup)
      await enter(setup)

      const frame = await frameShowing({ setup, text: 'Paste a OpenRouter api key' })
      expect(frame).toContain('Paste a OpenRouter api key')
      expect(frame).not.toContain('Paste a Anthropic api key')
    } finally {
      await teardown(setup)
    }
  })
})

describe('switching the active login', () => {
  it('moves the mark to the login the operator chose', async () => {
    const app = await appWith(['work@example.com', 'personal@example.com'])
    const setup = await opened({ app })

    try {
      await openOverlay(setup)
      await enter(setup)
      await down(setup)
      await down(setup)
      await enter(setup)
      await down(setup)
      await enter(setup)

      const switched = await until({
        holds: async () => {
          const active = await app.accounts.activeFor(EAuthProvider.Anthropic)
          const accounts = await app.accounts.list()
          return accounts.find((account) => account.id === active)?.label === 'personal@example.com'
        },
        within: 10_000,
      })
      expect(switched).toBe(true)

      const chosen = await app.accounts.activeFor(EAuthProvider.Anthropic)
      const accounts = await app.accounts.list()

      expect(accounts.find((account) => account.id === chosen)?.label).toBe('personal@example.com')
    } finally {
      await teardown(setup)
    }
  })
})

describe('removing a login', () => {
  it('removes the login chosen in the picker', async () => {
    const app = await appWith(['work@example.com', 'personal@example.com'])
    const setup = await opened({ app })

    try {
      await openOverlay(setup)
      await enter(setup)
      await down(setup)
      await down(setup)
      await down(setup)
      await enter(setup)
      await enter(setup)

      const frame = await frameShowing({ setup, text: 'Removed work@example.com.' })

      expect((await app.accounts.list()).map((account) => account.label)).toEqual([
        'personal@example.com',
      ])

      expect(frame).toContain('Removed work@example.com.')
      expect(frame).not.toContain('○ work@example.com')
    } finally {
      await teardown(setup)
    }
  })
})

describe('the browser sign-in flow', () => {
  const beginSignIn = async (setup: Mounted): Promise<void> => {
    await enter(setup)
    await enter(setup)
  }

  it('shows the URL to open when a sign-in begins', async () => {
    const setup = await opened({ app: await appWith(['work@example.com']) })

    try {
      await openOverlay(setup)
      await beginSignIn(setup)

      const frame = await frameShowing({ setup, text: 'claude.com/cai/oauth/auth' })

      expect(frame).toContain('SIGN IN')
      expect(frame).toContain('claude.com/cai/oauth/auth')
    } finally {
      await teardown(setup)
    }
  })

  it('opens the authorize URL in the browser when a sign-in begins', async () => {
    const app = await appWith(['work@example.com'])
    const setup = await opened({ app })

    try {
      await openOverlay(setup)
      await beginSignIn(setup)

      const openedUrl = await until({
        holds: async () => app.openedUrls.length === 1,
        within: 10_000,
      })
      expect(openedUrl).toBe(true)
      expect(app.openedUrls).toEqual(['https://claude.com/cai/oauth/authorize?code=true'])
    } finally {
      await teardown(setup)
    }
  })

  it('takes a bracketed paste of the code and says who signed in', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)
      await beginSignIn(setup)

      await setup.mockInput.pasteBracketedText('code#state-1')
      await setup.flush()
      setup.mockInput.pressEnter()
      await setup.flush()

      const frame = await frameShowing({ setup, text: 'signed-in@example.com' })
      expect(frame).toContain('signed-in@example.com')
    } finally {
      await teardown(setup)
    }
  })

  it('takes a typed code and says who signed in', async () => {
    const setup = await opened({ app: await appWith([]) })

    try {
      await openOverlay(setup)
      await beginSignIn(setup)

      await setup.mockInput.typeText('code#state-1')
      await setup.flush()
      setup.mockInput.pressEnter()
      await setup.flush()

      const frame = await frameShowing({ setup, text: 'signed-in@example.com' })
      expect(frame).toContain('signed-in@example.com')
    } finally {
      await teardown(setup)
    }
  })
})

describe('the device code flow', () => {
  it('shows the device code for OpenAI and signs in once the poll completes', async () => {
    const app = await appWith([])
    const setup = await opened({ app })

    try {
      await openOverlay(setup)
      await down(setup)
      await enter(setup)
      await enter(setup)

      const prompting = await frameShowing({ setup, text: 'ABCD-EFGH' })
      expect(prompting).toContain('ABCD-EFGH')
      expect(prompting).toContain('auth.openai.com/codex/device')

      const openedUrl = await until({
        holds: async () => app.openedUrls.length === 1,
        within: 10_000,
      })
      expect(openedUrl).toBe(true)
      expect(app.openedUrls).toEqual(['https://auth.openai.com/codex/device'])

      const frame = await frameShowing({ setup, text: 'codex-user@example.com' })
      expect(frame).toContain('codex-user@example.com')
      expect(await app.accounts.activeFor(EAuthProvider.OpenAI)).not.toBeUndefined()
    } finally {
      await teardown(setup)
    }
  })
})
