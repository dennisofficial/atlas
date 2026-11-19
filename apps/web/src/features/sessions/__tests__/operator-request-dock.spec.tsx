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

const SESSION = 'ses_1'

const itemOf = (extra: Partial<RequestItem> = {}): RequestItem => ({
  kind: ETranscriptKind.Request,
  id: 'evt_1',
  text: PROMPT,
  callId: 'call_1',
  prompt: PROMPT,
  state: 'pending',
  ...extra,
})

type FetchCall = { url: string; init: RequestInit | undefined }

const responseOf = (status: number, body: unknown): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response

let calls: FetchCall[] = []

const tRPCAnswer = (answer: { status: number; httpStatus?: number }) =>
  answer.status < 400
    ? { result: { data: null } }
    : {
        error: {
          message: 'refused',
          code: -32603,
          data: { code: 'REFUSED', httpStatus: answer.httpStatus ?? answer.status },
        },
      }

const stubFetch = (answer: { status: number; httpStatus?: number } = { status: 200 }) => {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    if (url === '/api/auth/get-session') return responseOf(200, { session: { token: 'tok_1' } })
    return responseOf(answer.status, tRPCAnswer(answer))
  }) as typeof fetch
}

const answers = () => calls.filter((call) => call.url.endsWith('/v1/trpc/operatorRequests.answer'))
const bodyOf = (call: FetchCall | undefined): unknown => {
  const body = JSON.parse(String(call?.init?.body)) as { atlasB64?: string }
  if (typeof body.atlasB64 !== 'string') return body
  return JSON.parse(Buffer.from(body.atlasB64, 'base64').toString('utf8')) as unknown
}

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
  it('finds the earliest pending call among the transcript rows', () => {
    const rows: TranscriptRow[] = [
      itemOf({ state: 'delivered' }),
      itemOf({ callId: 'call_2' }),
      itemOf({ callId: 'call_3' }),
    ]

    expect(pendingOperatorRequestOf(rows)?.callId).toBe('call_2')
    expect(pendingOperatorRequestOf([itemOf({ state: 'expired' })])).toBeNull()
  })

  it('draws nothing when no request is waiting', async () => {
    await mount(<OperatorRequestDock sessionId={SESSION} request={null} />)

    expect(document.body.textContent).not.toContain('Atlas needs you')
  })

  it('posts exactly the session, the call and the value over trpc', async () => {
    stubFetch()
    await mount(<OperatorRequestDock sessionId={SESSION} request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(answers()).toHaveLength(1)
    expect(answers()[0]?.init?.method).toBe('POST')
    expect(bodyOf(answers()[0])).toEqual({ sessionId: SESSION, callId: 'call_1', value: ANSWER })
    expect(document.body.innerHTML).not.toContain(ANSWER)
  })

  it('stays submitting until the transcript settles the request', async () => {
    stubFetch()
    await mount(<OperatorRequestDock sessionId={SESSION} request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(buttonNamed('Send')?.hasAttribute('disabled')).toBe(true)
    expect(document.body.textContent).toContain('Waiting for the session to confirm.')
  })

  it('cancels with the cancel flag', async () => {
    stubFetch()
    await mount(<OperatorRequestDock sessionId={SESSION} request={itemOf()} />)
    await click(buttonNamed('Cancel'))

    expect(bodyOf(answers()[0])).toEqual({ sessionId: SESSION, callId: 'call_1', cancel: true })
  })

  it('cancels on Escape', async () => {
    stubFetch()
    await mount(<OperatorRequestDock sessionId={SESSION} request={itemOf()} />)
    await type(ANSWER)
    await press('Escape')

    expect(bodyOf(answers()[0])).toEqual({ sessionId: SESSION, callId: 'call_1', cancel: true })
  })

  it('says the host does not know the session instead of echoing the wire code', async () => {
    stubFetch({ status: 404 })
    await mount(<OperatorRequestDock sessionId={SESSION} request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(document.body.textContent).toContain('this session is unknown to the agent host (404)')
    expect(document.body.textContent).not.toContain('session (404)')
  })

  it('says the host refused the answer instead of echoing a wire code', async () => {
    stubFetch({ status: 400 })
    await mount(<OperatorRequestDock sessionId={SESSION} request={itemOf()} />)
    await type(ANSWER)
    await press('Enter')

    expect(document.body.textContent).toContain('the agent host refused the answer (400)')
    expect(document.body.textContent).not.toContain('body (400)')
    await type(ANSWER)
    expect(buttonNamed('Send')?.hasAttribute('disabled')).toBe(false)
  })
})
