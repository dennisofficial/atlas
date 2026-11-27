import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as realNavigation from 'next/navigation'
import { act } from 'react'

let search = new URLSearchParams()

mock.module('next/navigation', () => ({
  ...realNavigation,
  useSearchParams: () => search,
}))

let seen: ReturnOutcome | undefined
let closed = 0

const { useBrowserReturnReader } = await import('../use-browser-return-reader')
const { useReturnOutcome } = await import('../use-return-outcome')

const returnOf = (state: string): URLSearchParams =>
  new URLSearchParams({ atlasReturn: 'connected', atlasState: state })

function Card({ state }: { state: string }) {
  seen = useReturnOutcome({ state, durable: undefined })
  return null
}

function Harness({ state }: { state: string }) {
  useBrowserReturnReader()
  return <Card state={state} />
}

const mount = async (
  state: string,
): Promise<{ render: () => Promise<void>; unmount: () => Promise<void> }> => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async () => {
    await act(async () => root.render(<Harness state={state} />))
  }
  await render()
  return { render, unmount: async () => act(async () => root.unmount()) }
}

beforeAll(() => {
  registerDom('http://localhost/sessions/ses_1')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('next/navigation', () => realNavigation)
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
  window.name = ''
  window.history.replaceState(null, '', '/sessions/ses_1')
  search = new URLSearchParams()
  seen = undefined
  closed = 0
})

describe('the browser-return reader on a page that stays mounted', () => {
  it('reads a return that arrives after the page is already open', async () => {
    const mounted = await mount('st_late')
    expect(browserReturns.read('st_late')).toBeUndefined()

    search = returnOf('st_late')
    await mounted.render()

    expect(browserReturns.read('st_late')).toEqual({ result: EReturnResult.Connected })
    expect(seen).toEqual({ result: EReturnResult.Connected })
    expect(window.location.search).toBe('')
    await mounted.unmount()
  })

  it('reads each new return once', async () => {
    const mounted = await mount('st_first')

    search = returnOf('st_first')
    await mounted.render()
    search = returnOf('st_second')
    await mounted.render()

    expect(browserReturns.read('st_first')).toEqual({ result: EReturnResult.Connected })
    expect(browserReturns.read('st_second')).toEqual({ result: EReturnResult.Connected })
    await mounted.unmount()
  })

  it('closes the window the opener named for the return', async () => {
    window.name = 'atlas-return-st_close'
    Object.defineProperty(window, 'close', { value: () => (closed += 1), configurable: true })
    const mounted = await mount('st_close')

    search = returnOf('st_close')
    await mounted.render()

    expect(closed).toBe(1)
    await mounted.unmount()
  })

  it('leaves a window it did not open alone', async () => {
    window.name = 'atlas'
    Object.defineProperty(window, 'close', { value: () => (closed += 1), configurable: true })
    const mounted = await mount('st_stay')

    search = returnOf('st_stay')
    await mounted.render()

    expect(closed).toBe(0)
    await mounted.unmount()
  })
})
