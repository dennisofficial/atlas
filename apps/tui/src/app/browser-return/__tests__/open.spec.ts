import { describe, expect, it } from 'bun:test'

import { EReturnResult, EReturnSurface, startLinkFor, type ReturnOutcome } from '@dltech/atlas-core'

import { browserReturns } from '@dltech/atlas-client/browser-return'

import type { LoopbackCopy } from '@dltech/atlas-client/loopback'
import type { LoopbackReturn, LoopbackStart } from '@dltech/atlas-client/loopback'
import { createBrowserReturnOpener } from '../open'

const COPY: LoopbackCopy = {
  connected: 'Signed in to linear',
  failed: (reason) => `Could not sign in to linear: ${reason ?? 'no reason given'}`,
}

const startUrlOf = (state: string): string => `https://atlas.example/return/start/${state}`

type Started = {
  href: string
  stopped: boolean
  settle: (outcome: ReturnOutcome | undefined) => void
}

type Harness = {
  urls: string[]
  started: Started[]
  open: (url: string) => void
  opener: ReturnType<typeof createBrowserReturnOpener>
}

const harness = (): Harness => {
  const urls: string[] = []
  const started: Started[] = []
  const open = (url: string): void => {
    urls.push(url)
  }
  const start = (args: LoopbackStart): LoopbackReturn => {
    const port = 4000 + started.length
    const href = startLinkFor({ url: args.url, surface: EReturnSurface.Tui, port })
    let settle: (outcome: ReturnOutcome | undefined) => void = () => undefined
    const outcome = new Promise<ReturnOutcome | undefined>((resolve) => {
      settle = resolve
    })
    const entry: Started = { href, stopped: false, settle }
    started.push(entry)
    args.open(href)
    return {
      port,
      href,
      outcome,
      stop: () => {
        entry.stopped = true
        settle(undefined)
      },
    }
  }
  return { urls, started, open, opener: createBrowserReturnOpener({ start }) }
}

const openWith = (harnessed: Harness, url: string): void => {
  harnessed.opener.open({ url, open: harnessed.open, copy: COPY })
}

describe('the tui browser-return opener', () => {
  it('opens a start link through a listener that names its port', () => {
    const harnessed = harness()

    openWith(harnessed, startUrlOf('state-open-1'))

    const opened = new URL(harnessed.urls[0] ?? '')
    expect(opened.pathname).toBe('/return/start/state-open-1')
    expect(opened.searchParams.get('surface')).toBe('tui')
    expect(opened.searchParams.get('port')).toBe('4000')
    expect(harnessed.started).toHaveLength(1)
  })

  it('reuses the listener when the same state is opened again', () => {
    const harnessed = harness()

    openWith(harnessed, startUrlOf('state-open-2'))
    openWith(harnessed, startUrlOf('state-open-2'))

    expect(harnessed.started).toHaveLength(1)
    expect(harnessed.urls[1]).toBe(harnessed.urls[0] ?? '')
  })

  it('replaces the listener when another state is opened', () => {
    const harnessed = harness()

    openWith(harnessed, startUrlOf('state-open-3'))
    openWith(harnessed, startUrlOf('state-open-4'))

    expect(harnessed.started).toHaveLength(2)
    expect(harnessed.started[0]?.stopped).toBe(true)
    expect(harnessed.started[1]?.stopped).toBe(false)
  })

  it('opens a plain url with no listener', () => {
    const harnessed = harness()
    const providerUrl = 'https://provider.example/oauth/authorize?client_id=atlas'

    openWith(harnessed, providerUrl)

    expect(harnessed.started).toHaveLength(0)
    expect(harnessed.urls).toEqual([providerUrl])
  })

  it('remembers the outcome the listener hands back, then starts over', async () => {
    const harnessed = harness()

    openWith(harnessed, startUrlOf('state-open-5'))
    harnessed.started[0]?.settle({ result: EReturnResult.Failed, reason: 'the provider refused' })
    await Promise.resolve()

    expect(browserReturns.read('state-open-5')).toEqual({
      result: EReturnResult.Failed,
      reason: 'the provider refused',
    })

    openWith(harnessed, startUrlOf('state-open-5'))
    expect(harnessed.started).toHaveLength(2)
  })

  it('stops every listener it holds when asked', () => {
    const harnessed = harness()

    openWith(harnessed, startUrlOf('state-open-6'))
    harnessed.opener.stop()

    expect(harnessed.started[0]?.stopped).toBe(true)
  })
})
