import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import { EReturnResult } from '@dltech/atlas-core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ETranscriptKind, type SignInItem } from '../data/transcript-items'
import { type SignInRetry, SignInRetryContext } from '../sign-in/sign-in-retry'
import { TranscriptSignIn } from '../transcript/transcript-sign-in'

const START_LINK = 'https://api.byatlas.io/return/start/st_1'

const startLinkOf = (state: string): string => `https://api.byatlas.io/return/start/${state}`

const itemOf = (extra: Partial<SignInItem> = {}): SignInItem => ({
  kind: ETranscriptKind.SignIn,
  id: 'e1',
  text: `sign in to the posthog MCP server: ${START_LINK}`,
  subject: 'posthog',
  url: START_LINK,
  ...extra,
})

const mount = async (args: { item?: SignInItem; retry?: SignInRetry } = {}) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <SignInRetryContext.Provider value={args.retry ?? null}>
        <TranscriptSignIn item={args.item ?? itemOf()} />
      </SignInRetryContext.Provider>,
    ),
  )
  return {
    text: (): string => document.body.textContent ?? '',
    click: async (label: string) => {
      const button = Array.from(document.body.querySelectorAll('button')).find(
        (element) => element.textContent === label,
      )
      if (button === undefined) throw new Error(`no "${label}" button`)
      await act(async () => button.click())
    },
    unmount: async () => act(async () => root.unmount()),
  }
}

beforeAll(() => {
  registerDom('https://byatlas.io/sessions/ses_1')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'open')
  Reflect.deleteProperty(window, 'atlasDesktop')
})

describe('the sign-in card', () => {
  it('names the server and offers the sign-in while nothing has answered', async () => {
    const card = await mount()

    expect(card.text()).toContain('posthog needs a sign-in')
    expect(card.text()).toContain('Sign in')
    expect(card.text()).not.toContain('api.byatlas.io')
    await card.unmount()
  })

  it('opens the start link in a window named after the state it waits on', async () => {
    const opened: unknown[][] = []
    Reflect.set(window, 'open', (...args: unknown[]) => {
      opened.push(args)
    })
    const card = await mount()

    await card.click('Sign in')

    expect(opened).toEqual([
      [`${START_LINK}?surface=web`, 'atlas-return-st_1', 'noopener,noreferrer'],
    ])
    await card.unmount()
  })

  it('reads the result the return delivered while the card stays open', async () => {
    browserReturns.remember({
      state: 'st_returned',
      outcome: { result: EReturnResult.Failed, reason: 'the provider refused the code' },
    })
    const card = await mount({ item: itemOf({ url: startLinkOf('st_returned') }) })

    expect(card.text()).toContain('Could not sign in to posthog')
    expect(card.text()).toContain('the provider refused the code')
    await card.unmount()
  })

  it('prefers the durable result over the one the browser brought back', async () => {
    browserReturns.remember({
      state: 'st_durable',
      outcome: { result: EReturnResult.Connected },
    })
    const card = await mount({
      item: itemOf({ url: startLinkOf('st_durable'), result: 'failed', reason: 'denied' }),
    })

    expect(card.text()).toContain('Could not sign in to posthog')
    expect(card.text()).toContain('denied')
    expect(card.text()).not.toContain('Signed in to posthog')
    await card.unmount()
  })

  it('says the server is signed in once the flow resolves', async () => {
    const card = await mount({
      item: itemOf({ result: 'connected', text: 'signed in to the posthog MCP server' }),
    })

    expect(card.text()).toContain('Signed in to posthog')
    expect(card.text()).not.toContain('Sign in')
    await card.unmount()
  })

  it('asks the agent to sign in again when the operator retries', async () => {
    const retries: string[] = []
    const card = await mount({
      item: itemOf({ result: 'failed', reason: 'denied' }),
      retry: (server) => retries.push(server),
    })

    await card.click('Try again')

    expect(retries).toEqual(['posthog'])
    await card.unmount()
  })
})
