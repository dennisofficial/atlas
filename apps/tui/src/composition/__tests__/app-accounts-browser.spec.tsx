import { EAuthProvider, toThreadId, type Account } from '@dltech/atlas-core'
import type { BrowserTicket } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { frameSettled, frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { until } from './app-fixture'
import { fakeApp, fakeSignedOutCloud, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const WIDE = { width: 150, height: 40 }
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize?state=s1'

type Mounted = Awaited<ReturnType<typeof testRender>>

type Browser = {
  app: FakeApp
  begun: EAuthProvider[]
  cancelled: () => number
  finish: () => Promise<void>
  fail: (reason: string) => void
}

const browserApp = (): Browser => {
  const base = fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cloud: fakeSignedOutCloud(),
  })

  const begun: EAuthProvider[] = []
  let cancels = 0
  let resolve: (account: Account) => void = () => undefined
  let reject: (error: Error) => void = () => undefined

  const beginBrowser = async (provider: EAuthProvider): Promise<BrowserTicket> => {
    begun.push(provider)
    const login = new Promise<Account>((done, failed) => {
      resolve = done
      reject = failed
    })
    login.catch(() => undefined)

    return {
      provider,
      url: AUTHORIZE_URL,
      login,
      cancel: async () => {
        cancels += 1
      },
    }
  }

  const accounts = Object.assign(base.accounts, { beginBrowser })

  return {
    app: { ...base, accounts },
    begun,
    cancelled: () => cancels,
    finish: async () => {
      resolve(
        await accounts.addApiKey({ provider: EAuthProvider.OpenAI, apiKey: 'sk-browser-signed-in' }),
      )
    },
    fail: (reason) => reject(new Error(reason)),
  }
}

async function opened(app: FakeApp): Promise<Mounted> {
  const setup = await testRender(
    <App
      app={app}
      opened={{ threadId: toThreadId('opened-thread'), events: [], turns: [], name: null, started: true }}
      credentialNotice={null}
    />,
    WIDE,
  )
  await setup.flush()
  await frameSettled({ setup, within: 3000 })
  return setup
}

const press = async (args: { setup: Mounted; times: number; key: 'down' | 'enter' }) => {
  for (let index = 0; index < args.times; index += 1) {
    if (args.key === 'down') args.setup.mockInput.pressArrow('down')
    else args.setup.mockInput.pressEnter()
    await args.setup.flush()
    await frameSettled({ setup: args.setup, within: 3000 })
  }
}

const beginSignIn = async (args: { setup: Mounted; downs: number }): Promise<void> => {
  args.setup.mockInput.pressKey('a', { ctrl: true })
  await args.setup.flush()
  await frameShowing({ setup: args.setup, text: 'MODEL PROVIDERS' })
  await press({ setup: args.setup, times: args.downs, key: 'down' })
  await press({ setup: args.setup, times: 2, key: 'enter' })
}

const beginOpenAiSignIn = (setup: Mounted): Promise<void> => beginSignIn({ setup, downs: 1 })

describe('the Anthropic browser sign-in', () => {
  it('begins the browser flow for Anthropic and opens the authorize url', async () => {
    const browser = browserApp()
    const setup = await opened(browser.app)

    try {
      await beginSignIn({ setup, downs: 0 })

      const frame = await frameShowing({ setup, text: 'waiting for the browser' })

      expect(browser.begun).toEqual([EAuthProvider.Anthropic])
      expect(frame).toContain(AUTHORIZE_URL)
      expect(frame).not.toContain('waiting for a paste')
      expect(browser.app.openedUrls).toEqual([AUTHORIZE_URL])
    } finally {
      await teardown(setup)
    }
  })
})

describe('the OpenAI browser sign-in', () => {
  it('begins the browser flow and shows the authorize url without a typing line', async () => {
    const browser = browserApp()
    const setup = await opened(browser.app)

    try {
      await beginOpenAiSignIn(setup)

      const frame = await frameShowing({ setup, text: 'auth.openai.com/oauth/authorize' })

      expect(browser.begun).toEqual([EAuthProvider.OpenAI])
      expect(frame).toContain('waiting for the browser')
      expect(frame).not.toContain('waiting for a paste')
      expect(frame).not.toContain('ABCD-EFGH')
    } finally {
      await teardown(setup)
    }
  })

  it('opens the authorize url in the browser', async () => {
    const browser = browserApp()
    const setup = await opened(browser.app)

    try {
      await beginOpenAiSignIn(setup)

      const openedUrl = await until({
        holds: async () => browser.app.openedUrls.length === 1,
        within: 10_000,
      })

      expect(openedUrl).toBe(true)
      expect(browser.app.openedUrls).toEqual([AUTHORIZE_URL])
    } finally {
      await teardown(setup)
    }
  })

  it('says who signed in once the login resolves', async () => {
    const browser = browserApp()
    const setup = await opened(browser.app)

    try {
      await beginOpenAiSignIn(setup)
      await frameShowing({ setup, text: 'waiting for the browser' })
      await browser.finish()

      const frame = await frameShowing({ setup, text: 'Signed in as' })

      expect(frame).toContain('Signed in as')
      expect(frame).not.toContain('waiting for the browser')
    } finally {
      await teardown(setup)
    }
  })

  it('shows the failure when the login rejects', async () => {
    const browser = browserApp()
    const setup = await opened(browser.app)

    try {
      await beginOpenAiSignIn(setup)
      await frameShowing({ setup, text: 'waiting for the browser' })
      browser.fail('the sign-in timed out')

      const frame = await frameShowing({ setup, text: 'the sign-in timed out' })
      expect(frame).toContain('the sign-in timed out')
    } finally {
      await teardown(setup)
    }
  })

  it('cancels the pending login on escape and returns to the list', async () => {
    const browser = browserApp()
    const setup = await opened(browser.app)

    try {
      await beginOpenAiSignIn(setup)
      await frameShowing({ setup, text: 'waiting for the browser' })
      setup.mockInput.pressEscape()
      await setup.flush()

      const frame = await frameWhen({
        setup,
        holds: (captured) => captured.includes('MODEL PROVIDERS') && !captured.includes('waiting for the browser'),
        describe: 'the prompt to close back to the list',
      })

      expect(browser.cancelled()).toBe(1)
      expect(frame).not.toContain('Signed in as')
    } finally {
      await teardown(setup)
    }
  })
})
