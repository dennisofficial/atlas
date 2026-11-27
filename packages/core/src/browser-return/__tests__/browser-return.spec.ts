import { describe, expect, it } from 'bun:test'

import {
  browserReturnOf,
  EReturnResult,
  EReturnSurface,
  isStartLink,
  loopbackReplyOf,
  returnOutcomeOf,
  returnLinkOf,
  returnPortOf,
  returnSurfaceOf,
  returnTargetOf,
  startLinkFor,
  startLinkOf,
  stateOfStartLink,
  withoutReturnParams,
} from '..'

const START = 'https://api.byatlas.io/return/start/state-1'
const FAILED = { result: EReturnResult.Failed, reason: 'mcp.example.com answered: denied' }
const CONNECTED = { result: EReturnResult.Connected }

describe('the start link', () => {
  it('lives on the public origin', () => {
    expect(startLinkOf({ origin: 'https://api.byatlas.io/v1', state: 'state-1' })).toBe(START)
  })

  it('names the surface and the tui port, replacing older ones', () => {
    expect(startLinkFor({ url: START, surface: EReturnSurface.Ios })).toBe(`${START}?surface=ios`)
    expect(
      startLinkFor({
        url: `${START}?surface=web&port=2000`,
        surface: EReturnSurface.Tui,
        port: 53682,
      }),
    ).toBe(`${START}?surface=tui&port=53682`)
    expect(startLinkFor({ url: `${START}?port=2000`, surface: EReturnSurface.Web })).toBe(
      `${START}?surface=web`,
    )
  })

  it('leaves a link that is not a start link untouched', () => {
    const provider = 'https://mcp.linear.app/authorize?state=s'
    expect(startLinkFor({ url: provider, surface: EReturnSurface.Ios })).toBe(provider)
    expect(startLinkFor({ url: 'not a url', surface: EReturnSurface.Web })).toBe('not a url')
    expect(isStartLink(provider)).toBe(false)
    expect(isStartLink(START)).toBe(true)
  })

  it('carries its state', () => {
    expect(stateOfStartLink(`${START}?surface=ios`)).toBe('state-1')
    expect(stateOfStartLink('https://api.byatlas.io/return/start/')).toBeUndefined()
  })
})

describe('returnTargetOf', () => {
  const recorded = { surface: EReturnSurface.Desktop }

  it('follows a cookie for the same state', () => {
    expect(
      returnTargetOf({
        state: 'state-1',
        cookie: { state: 'state-1', surface: EReturnSurface.Tui, port: 53682 },
        recorded,
      }),
    ).toEqual({ surface: EReturnSurface.Tui, port: 53682 })
  })

  it('falls back to the recorded target without a cookie or with another state', () => {
    expect(returnTargetOf({ state: 'state-1', cookie: undefined, recorded })).toEqual(recorded)
    expect(
      returnTargetOf({
        state: 'state-1',
        cookie: { state: 'state-0', surface: EReturnSurface.Ios },
        recorded,
      }),
    ).toEqual(recorded)
  })

  it('treats a tui target without a usable port as web, and drops a port elsewhere', () => {
    expect(
      returnTargetOf({
        state: 's',
        cookie: undefined,
        recorded: { surface: EReturnSurface.Tui, port: 80 },
      }),
    ).toEqual({ surface: EReturnSurface.Web })
    expect(
      returnTargetOf({
        state: 's',
        cookie: undefined,
        recorded: { surface: EReturnSurface.Ios, port: 53682 },
      }),
    ).toEqual({ surface: EReturnSurface.Ios })
  })
})

describe('surface and port parsing', () => {
  it('reads known surfaces and unprivileged ports only', () => {
    expect(returnSurfaceOf('tui')).toBe(EReturnSurface.Tui)
    expect(returnSurfaceOf('cli')).toBeUndefined()
    expect(returnPortOf('53682')).toBe(53682)
    expect(returnPortOf('80')).toBeUndefined()
    expect(returnPortOf('12ab')).toBeUndefined()
    expect(returnPortOf('70000')).toBeUndefined()
  })
})

describe('returnLinkOf', () => {
  const base = {
    webOrigin: 'https://byatlas.io',
    path: '/sessions/ses_1',
    state: 'state-1',
  }

  it('redirects the web back to its page with the result', () => {
    expect(
      returnLinkOf({ ...base, target: { surface: EReturnSurface.Web }, outcome: CONNECTED }),
    ).toEqual({
      kind: 'redirect',
      url: 'https://byatlas.io/sessions/ses_1?atlasReturn=connected&atlasState=state-1',
    })
  })

  it('opens the mac and the ios app, with the web page as fallback', () => {
    const mac = returnLinkOf({
      ...base,
      target: { surface: EReturnSurface.Desktop },
      outcome: FAILED,
    })
    const ios = returnLinkOf({
      ...base,
      target: { surface: EReturnSurface.Ios },
      outcome: CONNECTED,
    })
    expect(mac).toMatchObject({ kind: 'app' })
    expect(mac.url).toStartWith(
      'atlas://open/sessions/ses_1?atlasReturn=failed&atlasState=state-1&atlasReason=',
    )
    expect(ios.url).toBe('atlas:///sessions/ses_1?atlasReturn=connected&atlasState=state-1')
    if (ios.kind === 'app') expect(ios.webUrl).toStartWith('https://byatlas.io/sessions/ses_1?')
  })

  it('redirects the tui to its loopback listener', () => {
    expect(
      returnLinkOf({
        ...base,
        target: { surface: EReturnSurface.Tui, port: 53682 },
        outcome: CONNECTED,
      }).url,
    ).toBe('http://127.0.0.1:53682/atlas-return?atlasReturn=connected&atlasState=state-1')
  })

  it('keeps a query the page already has', () => {
    expect(
      returnLinkOf({
        ...base,
        path: '/settings/mcp?tab=servers',
        target: { surface: EReturnSurface.Web },
        outcome: CONNECTED,
      }).url,
    ).toBe('https://byatlas.io/settings/mcp?tab=servers&atlasReturn=connected&atlasState=state-1')
  })
})

describe('browserReturnOf', () => {
  it('reads a result back from every return link', () => {
    for (const surface of [EReturnSurface.Web, EReturnSurface.Desktop, EReturnSurface.Ios]) {
      const link = returnLinkOf({
        target: { surface },
        webOrigin: 'https://byatlas.io',
        path: '/sessions/ses_1',
        state: 'state-1',
        outcome: FAILED,
      })
      expect(browserReturnOf(link.url)).toEqual({ state: 'state-1', outcome: FAILED })
    }
  })

  it('reads nothing without a state, a known result or a url', () => {
    expect(browserReturnOf('atlas:///x?atlasReturn=connected')).toBeUndefined()
    expect(browserReturnOf('atlas:///x?atlasReturn=maybe&atlasState=s')).toBeUndefined()
    expect(browserReturnOf('atlas://')).toBeUndefined()
    expect(browserReturnOf('nope')).toBeUndefined()
  })

  it('strips its params from a page url', () => {
    expect(
      withoutReturnParams(
        'https://byatlas.io/sessions/ses_1?tab=a&atlasReturn=failed&atlasState=s&atlasReason=r',
      ),
    ).toBe('https://byatlas.io/sessions/ses_1?tab=a')
  })
})

describe('returnOutcomeOf', () => {
  it('shows the local result until the durable one arrives, which then wins', () => {
    expect(returnOutcomeOf({ durable: undefined, local: FAILED })).toEqual(FAILED)
    expect(returnOutcomeOf({ durable: CONNECTED, local: FAILED })).toEqual(CONNECTED)
    expect(returnOutcomeOf({ durable: undefined, local: undefined })).toBeUndefined()
  })
})

describe('loopbackReplyOf', () => {
  const url = 'http://127.0.0.1:53682/atlas-return?atlasReturn=connected&atlasState=state-1'
  const accept = { method: 'GET', address: '127.0.0.1', url, port: 53682, state: 'state-1' }

  it('accepts the return for its state from this machine', () => {
    expect(loopbackReplyOf(accept)).toEqual({ accepted: true, outcome: CONNECTED })
    expect(loopbackReplyOf({ ...accept, address: '::ffff:127.0.0.1' }).accepted).toBe(true)
  })

  it('refuses another state, host, port, path, method or peer', () => {
    expect(loopbackReplyOf({ ...accept, state: 'state-2' }).accepted).toBe(false)
    expect(
      loopbackReplyOf({ ...accept, url: url.replace('127.0.0.1:53682', 'attacker.example:53682') })
        .accepted,
    ).toBe(false)
    expect(loopbackReplyOf({ ...accept, port: 53683 }).accepted).toBe(false)
    expect(loopbackReplyOf({ ...accept, url: url.replace('/atlas-return', '/x') }).accepted).toBe(
      false,
    )
    expect(loopbackReplyOf({ ...accept, method: 'POST' }).accepted).toBe(false)
    expect(loopbackReplyOf({ ...accept, address: '10.0.0.2' }).accepted).toBe(false)
  })
})
