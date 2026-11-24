import { describe, expect, test } from 'bun:test'

import * as wire from '@dltech/atlas-wire/web'

import {
  ENavigation,
  browserUrlOf,
  externalUrlOf,
  paneNavigationOf,
  PREVIEW_CALLBACK_HOST,
  PREVIEW_CALLBACK_START_PATH,
  previewCallbackStartOf,
  sameOrigin,
  windowNavigationOf,
} from '../links.js'

describe('externalUrlOf', () => {
  test('hands a web address to the default browser', () => {
    expect(externalUrlOf('https://github.com/dennisofficial/atlas/pull/993')).toBe(
      'https://github.com/dennisofficial/atlas/pull/993',
    )
    expect(externalUrlOf('http://example.com/a?q=1')).toBe('http://example.com/a?q=1')
  })

  test('hands a mail address to the default mail client', () => {
    expect(externalUrlOf('mailto:hello@byatlas.io')).toBe('mailto:hello@byatlas.io')
  })

  test('refuses anything the shell is not allowed to open', () => {
    expect(externalUrlOf('javascript:alert(1)')).toBe(null)
    expect(externalUrlOf('file:///etc/passwd')).toBe(null)
    expect(externalUrlOf('chrome://settings')).toBe(null)
  })

  test('refuses what is not a usable address', () => {
    expect(externalUrlOf('')).toBe(null)
    expect(externalUrlOf('github.com/atlas')).toBe(null)
    expect(externalUrlOf(undefined)).toBe(null)
    expect(externalUrlOf({ toString: () => 'https://example.com' })).toBe(null)
  })
})

describe('sameOrigin', () => {
  test('keeps a page on one origin inside the pane that shows it', () => {
    expect(sameOrigin('https://3100-abc.byatlas.dev/docs', 'https://3100-abc.byatlas.dev/')).toBe(
      true,
    )
    expect(sameOrigin('http://127.0.0.1:4100/app', 'http://127.0.0.1:4100/')).toBe(true)
  })

  test('treats another port, host or protocol as somewhere else', () => {
    expect(sameOrigin('http://127.0.0.1:4101/app', 'http://127.0.0.1:4100/')).toBe(false)
    expect(sameOrigin('https://example.com/', 'https://github.com/')).toBe(false)
    expect(sameOrigin('https://example.com/', 'http://example.com/')).toBe(false)
  })

  test('compares origins only, so a path never decides it', () => {
    expect(sameOrigin('https://example.com/other', 'https://example.com/')).toBe(true)
  })

  test('has nothing in common with a non-web address or an unloaded pane', () => {
    expect(sameOrigin('mailto:hello@byatlas.io', 'mailto:hello@byatlas.io')).toBe(false)
    expect(sameOrigin('about:blank', 'about:blank')).toBe(false)
    expect(sameOrigin('https://example.com/', '')).toBe(false)
    expect(sameOrigin('https://example.com/', undefined)).toBe(false)
  })
})

describe('sign-in navigation', () => {
  const GOOGLE =
    'https://accounts.google.com/o/oauth2/auth?redirect_uri=https%3A%2F%2Fcallback.byatlas.dev%2Fapi%2Fauth%2Fcallback%2Fgoogle'

  test('keeps the app window on its own origin', () => {
    expect(
      windowNavigationOf({
        url: 'http://127.0.0.1:4100/settings',
        pageUrl: 'http://127.0.0.1:4100/',
      }),
    ).toEqual({ kind: ENavigation.Stay })
  })

  test('sends a sign-in the app window starts to the default browser', () => {
    expect(
      windowNavigationOf({
        url: 'https://mcp.linear.app/authorize?state=s',
        pageUrl: 'http://127.0.0.1:4100/settings/integrations',
      }),
    ).toEqual({ kind: ENavigation.Browser, url: 'https://mcp.linear.app/authorize?state=s' })
  })

  test('starts a preview sign-in on the callback host so it returns to the app', () => {
    const plan = paneNavigationOf(GOOGLE)
    expect(plan.kind).toBe(ENavigation.Browser)
    const start = new URL(plan.url)
    expect(start.origin).toBe('https://callback.byatlas.dev')
    expect(start.pathname).toBe('/__atlas/start')
    expect(start.searchParams.get('to')).toBe(GOOGLE)
    expect(browserUrlOf(GOOGLE)).toBe(plan.url)
  })

  test('leaves every other preview navigation in the pane', () => {
    expect(paneNavigationOf('https://3100-abc.byatlas.dev/docs')).toEqual({
      kind: ENavigation.Stay,
    })
    expect(
      previewCallbackStartOf('http://example.com/?redirect_uri=https://callback.byatlas.dev/x'),
    ).toBe(null)
  })
})

describe('the callback host', () => {
  test('matches the wire names the preview worker answers on', () => {
    expect(PREVIEW_CALLBACK_HOST).toBe(wire.PREVIEW_CALLBACK_HOST)
    expect(PREVIEW_CALLBACK_START_PATH).toBe(wire.PREVIEW_CALLBACK_START_PATH)
  })
})
