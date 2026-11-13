import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import {
  ETranscriptKind,
  type RequestItem,
  type TranscriptRow,
} from '@/features/threads/data/transcript-items'

import { pendingOperatorRequestOf } from '../data/use-operator-request'
import { OperatorRequestDock } from '../operator-request-dock'

const PROMPT = 'Paste the login code from your email'
const ANSWER = 'hunter2'

const itemOf = (extra: Partial<RequestItem> = {}): RequestItem => ({
  kind: ETranscriptKind.Request,
  id: 'evt_1',
  text: PROMPT,
  requestId: 'req_1',
  prompt: PROMPT,
  state: 'pending',
  expiresAt: '2026-11-12T10:15:00.000Z',
  ...extra,
})

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

const field = () => document.querySelector('textarea')
const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

const type = async (text: string) => {
  const input = field()
  if (input === null) throw new Error('no field')
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const press = (key: string) =>
  act(async () => {
    field()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const click = (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('the operator request dock', () => {
  it('finds the pending request among the transcript rows', () => {
    const rows: TranscriptRow[] = [itemOf({ state: 'delivered' }), itemOf({ requestId: 'req_2' })]

    expect(pendingOperatorRequestOf(rows)?.requestId).toBe('req_2')
    expect(pendingOperatorRequestOf([itemOf({ state: 'expired' })])).toBeNull()
  })

  it('draws nothing when no request is waiting', async () => {
    await mount(<OperatorRequestDock request={null} />)

    expect(document.body.textContent).not.toContain('Atlas needs you')
  })

  it('posts exactly the request id and the value, with the stream bearer', async () => {
    stubFetch()
    await mount(<OperatorRequestDock request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(answers()).toHaveLength(1)
    expect(bodyOf(answers()[0])).toEqual({ requestId: 'req_1', value: ANSWER })
    expect(answers()[0]?.init?.headers).toMatchObject({ authorization: 'Bearer tok_1' })
    expect(document.body.innerHTML).not.toContain(ANSWER)
  })

  it('stays submitting until the transcript settles the request', async () => {
    stubFetch()
    await mount(<OperatorRequestDock request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(buttonNamed('Send')?.hasAttribute('disabled')).toBe(true)
    expect(document.body.textContent).toContain('Waiting for the session to confirm.')
  })

  it('cancels with the cancel flag', async () => {
    stubFetch()
    await mount(<OperatorRequestDock request={itemOf()} />)
    await click(buttonNamed('Cancel'))

    expect(bodyOf(answers()[0])).toEqual({ requestId: 'req_1', cancel: true })
  })

  it('cancels on Escape', async () => {
    stubFetch()
    await mount(<OperatorRequestDock request={itemOf()} />)
    await type(ANSWER)
    await press('Escape')

    expect(bodyOf(answers()[0])).toEqual({ requestId: 'req_1', cancel: true })
  })

  it('says the host refused the answer instead of echoing a wire code', async () => {
    stubFetch({ status: 400, body: { reason: 'body' } })
    await mount(<OperatorRequestDock request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(document.body.textContent).toContain('the agent host refused the answer (400)')
    expect(document.body.textContent).not.toContain('body (400)')
    await type(ANSWER)
    expect(buttonNamed('Send')?.hasAttribute('disabled')).toBe(false)
  })
})
