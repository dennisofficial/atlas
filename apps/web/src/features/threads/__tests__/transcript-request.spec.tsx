import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ETranscriptKind, type RequestItem } from '../data/transcript-items'
import { TranscriptRequest } from '../transcript/transcript-request'

const PROMPT = 'Paste the login code from your email'
const SECRET = 'hunter2'

const itemOf = (extra: Partial<RequestItem> = {}): RequestItem => ({
  kind: ETranscriptKind.Request,
  id: 'evt_1',
  text: PROMPT,
  requestId: 'req_1',
  prompt: PROMPT,
  secret: true,
  state: 'pending',
  expiresAt: '2026-11-12T10:15:00.000Z',
  ...extra,
})

const render = (extra: Partial<RequestItem> = {}) =>
  renderToStaticMarkup(<TranscriptRequest item={itemOf(extra)} />)

type FetchCall = { url: string; init: RequestInit | undefined }

const responseOf = (status: number, body: unknown): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response

let calls: FetchCall[] = []

const stubFetch = (answer: { status: number; body: unknown } = { status: 200, body: {} }) => {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    if (url === '/api/auth/get-session') return responseOf(200, { session: { token: 'tok_1' } })
    return responseOf(answer.status, answer.body)
  }) as typeof fetch
}

const answers = () => calls.filter((call) => call.url.endsWith('/operator-requests/answer'))
const bodyOf = (call: FetchCall | undefined) => JSON.parse(String(call?.init?.body))

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    createRoot(container).render(element)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const field = () => document.querySelector('input')
const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

const type = async (text: string) => {
  const input = field()
  if (input === null) throw new Error('no input')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const press = (key: string) =>
  act(async () => {
    const input = field()
    input?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const click = (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('the operator request card', () => {
  it('asks the question and masks a secret field', () => {
    const html = render()

    expect(html).toContain(PROMPT)
    expect(html).toContain('type="password"')
    expect(html).toContain('Submit')
    expect(html).toContain('Cancel')
  })

  it('leaves the field readable when the answer is not secret', () => {
    const html = render({ secret: false })

    expect(html).toContain('type="text"')
    expect(html).not.toContain('type="password"')
  })

  it('reads the operator answered, without the value', () => {
    const html = render({ state: 'delivered', path: '/tmp/requests/req_1', bytes: 7 })

    expect(html).toContain('The operator answered')
    expect(html).toContain(PROMPT)
    expect(html).not.toContain('Submit')
    expect(html).not.toContain('type="password"')
  })

  it('reads the expiry of an unanswered request', () => {
    const html = render({ state: 'expired' })

    expect(html).toContain('The request expired')
    expect(html).not.toContain('Submit')
  })

  it('reads why the request was cancelled', () => {
    const html = render({ state: 'cancelled', reason: 'the turn was interrupted' })

    expect(html).toContain('The operator cancelled the request')
    expect(html).toContain('the turn was interrupted')
  })

  it('reads a failed delivery as an error', () => {
    const html = render({ state: 'failed', reason: 'the sandbox refused the write' })

    expect(html).toContain('Could not deliver the operator&#x27;s value')
    expect(html).toContain('the sandbox refused the write')
    expect(html).toContain('data-status="error"')
  })
})

describe('the operator request card in an open transcript', () => {
  it('starts with Submit disabled and enables it once a value is typed', async () => {
    stubFetch()
    await mount(<TranscriptRequest item={itemOf()} />)

    expect(field()?.getAttribute('type')).toBe('password')
    expect(buttonNamed('Submit')?.hasAttribute('disabled')).toBe(true)
    await type(SECRET)
    expect(buttonNamed('Submit')?.hasAttribute('disabled')).toBe(false)
  })

  it('posts the value once on Enter and never renders it back', async () => {
    stubFetch()
    await mount(<TranscriptRequest item={itemOf()} />)
    await type(SECRET)
    await press('Enter')
    await press('Enter')

    expect(answers()).toHaveLength(1)
    expect(bodyOf(answers()[0])).toEqual({ requestId: 'req_1', value: SECRET })
    expect(answers()[0]?.init?.headers).toMatchObject({ authorization: 'Bearer tok_1' })
    expect(document.body.innerHTML).not.toContain(SECRET)
    expect(document.body.textContent).toContain('Waiting for the session to confirm.')
  })

  it('posts one value when Submit is clicked', async () => {
    stubFetch()
    await mount(<TranscriptRequest item={itemOf()} />)
    await type(SECRET)
    await click(buttonNamed('Submit'))
    await click(buttonNamed('Submit'))

    expect(answers()).toHaveLength(1)
  })

  it('cancels with the cancel flag', async () => {
    stubFetch()
    await mount(<TranscriptRequest item={itemOf()} />)
    await click(buttonNamed('Cancel'))

    expect(answers()).toHaveLength(1)
    expect(bodyOf(answers()[0])).toEqual({ requestId: 'req_1', cancel: true })
  })

  it('cancels on Escape', async () => {
    stubFetch()
    await mount(<TranscriptRequest item={itemOf()} />)
    await press('Escape')

    expect(bodyOf(answers()[0])).toEqual({ requestId: 'req_1', cancel: true })
  })

  it('keeps the card open and says why when the host refuses the answer', async () => {
    stubFetch({ status: 409, body: { reason: 'not_held_here' } })
    await mount(<TranscriptRequest item={itemOf()} />)
    await type(SECRET)
    await press('Enter')

    expect(document.body.textContent).toContain('not_held_here')
    expect(document.body.textContent).not.toContain(SECRET)
    expect(buttonNamed('Submit')?.hasAttribute('disabled')).toBe(false)
  })
})
