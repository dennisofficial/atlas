import { describe, expect, test } from 'bun:test'

import * as wire from '@dltech/atlas-wire/web'
import { APP_URL_SCHEME, DESKTOP_OPEN_HOST as CORE_OPEN_HOST } from '@dltech/atlas-core'

import {
  DESKTOP_NAVIGATE_EVENT,
  DESKTOP_OPEN_HOST,
  DESKTOP_PREVIEW_CALLBACK_EVENT,
  DESKTOP_PREVIEW_CALLBACK_HOST,
  DESKTOP_URL_SCHEME,
  EDeepLinkKind,
  EDeepLinkPlan,
  createDeepLinkOpener,
  deepLinkOf,
  landingUrlOf,
  launchPlanOf,
  livePlanOf,
  loadedPlanOf,
  protocolClientArgsOf,
} from '../deep-links.js'

describe('the shell speaks the wire names', () => {
  test('matches the scheme, hosts and events the API, worker and web app use', () => {
    expect(DESKTOP_URL_SCHEME).toBe(APP_URL_SCHEME)
    expect(DESKTOP_OPEN_HOST).toBe(CORE_OPEN_HOST)
    expect(DESKTOP_PREVIEW_CALLBACK_HOST).toBe(wire.DESKTOP_PREVIEW_CALLBACK_HOST)
    expect(DESKTOP_NAVIGATE_EVENT).toBe(wire.DESKTOP_NAVIGATE_EVENT)
    expect(DESKTOP_PREVIEW_CALLBACK_EVENT).toBe(wire.DESKTOP_PREVIEW_CALLBACK_EVENT)
  })
})

const PAGE = 'http://127.0.0.1:4242/settings/integrations'
const navigation = {
  urlOf: () => PAGE,
  navigate: ({ win, path }) => win.calls.push(`navigate ${path}`),
}

describe('deepLinkOf', () => {
  test('reads the path and query of an atlas://open link', () => {
    expect(deepLinkOf('atlas://open/settings/integrations?mcpOauth=connected')).toEqual({
      kind: EDeepLinkKind.Open,
      path: '/settings/integrations?mcpOauth=connected',
    })
    expect(deepLinkOf('atlas://open')).toEqual({ kind: EDeepLinkKind.Open, path: '/' })
  })

  test('reads the iOS shape atlas:///sessions/<id> as an in-app path', () => {
    expect(deepLinkOf('atlas:///sessions/ses_1?mcpOauth=connected')).toEqual({
      kind: EDeepLinkKind.Open,
      path: '/sessions/ses_1?mcpOauth=connected',
    })
  })

  test('reads a preview callback and a bare focus', () => {
    expect(deepLinkOf('atlas://preview-callback/api/auth/callback/google?code=c')).toEqual({
      kind: EDeepLinkKind.PreviewCallback,
      path: '/api/auth/callback/google?code=c',
    })
    expect(deepLinkOf('atlas://focus')).toEqual({ kind: EDeepLinkKind.Focus })
  })

  test('refuses other schemes, hosts and paths that leave the app', () => {
    expect(deepLinkOf('https://open/settings')).toBeNull()
    expect(deepLinkOf('atlas://elsewhere/settings')).toBeNull()
    expect(deepLinkOf('atlas://open//evil.example/x')).toBeNull()
    expect(deepLinkOf('atlas://preview-callback//evil.example/x')).toBeNull()
    expect(deepLinkOf('not a url')).toBeNull()
    expect(deepLinkOf(undefined)).toBeNull()
  })
})

describe('landingUrlOf', () => {
  test('lands a cold start on the link path through the session route', () => {
    const url = new URL(
      landingUrlOf({
        pageUrl: 'http://127.0.0.1:4242/desktop/session?secret=s',
        path: '/settings/integrations?mcpOauth=connected',
      }),
    )
    expect(url.pathname).toBe('/desktop/session')
    expect(url.searchParams.get('secret')).toBe('s')
    expect(url.searchParams.get('next')).toBe('/settings/integrations?mcpOauth=connected')
  })

  test('falls back to the session a notification launched', () => {
    const url = new URL(
      landingUrlOf({
        pageUrl: 'http://127.0.0.1:4242/desktop/session?secret=s',
        sessionId: 'ses_1',
      }),
    )
    expect(url.searchParams.get('next')).toBe('/sessions/ses_1')
  })
})

describe('launchPlanOf', () => {
  test('lands on the first open link and replays the rest', () => {
    expect(
      launchPlanOf(['atlas://focus', 'atlas://open/settings', 'atlas://bogus', 'atlas://open/x']),
    ).toEqual({ path: '/settings', replay: ['atlas://focus', 'atlas://open/x'] })
    expect(launchPlanOf([])).toEqual({ path: undefined, replay: [] })
  })
})

describe('livePlanOf', () => {
  test('hands an open link to the router of a loaded page', () => {
    const plan = livePlanOf({
      link: deepLinkOf('atlas://open/sessions/ses_1'),
      pageUrl: PAGE,
      appUrl: PAGE,
      loading: false,
    })
    expect(plan).toEqual({
      kind: EDeepLinkPlan.NavigateInPage,
      path: '/sessions/ses_1',
      url: 'http://127.0.0.1:4242/sessions/ses_1',
    })
  })

  test('hands a preview callback to the preview', () => {
    const plan = livePlanOf({
      link: deepLinkOf('atlas://preview-callback/cb?code=c'),
      pageUrl: PAGE,
      appUrl: PAGE,
      loading: false,
    })
    expect(plan.script).toContain(JSON.stringify(DESKTOP_PREVIEW_CALLBACK_EVENT))
  })

  test('carries the path as data without injecting script', () => {
    const plan = livePlanOf({
      link: { kind: EDeepLinkKind.Open, path: '/x"));alert(1);//' },
      pageUrl: PAGE,
      appUrl: PAGE,
      loading: false,
    })
    expect(plan.path).toBe('/x%22));alert(1);//')
    expect(plan.script).toBeUndefined()
  })

  test('only focuses for atlas://focus', () => {
    expect(
      livePlanOf({ link: deepLinkOf('atlas://focus'), pageUrl: PAGE, loading: false }).kind,
    ).toBe(EDeepLinkPlan.Focus)
  })

  test('waits while the window loads or shows no page yet', () => {
    const link = deepLinkOf('atlas://open/x')
    expect(livePlanOf({ link, pageUrl: PAGE, loading: true }).kind).toBe(EDeepLinkPlan.Defer)
    expect(livePlanOf({ link, pageUrl: '', loading: false }).kind).toBe(EDeepLinkPlan.Defer)
  })
})

describe('loadedPlanOf', () => {
  test('loads the link path once the page has loaded', () => {
    expect(
      loadedPlanOf({ link: deepLinkOf('atlas://open/sessions/s'), pageUrl: PAGE, appUrl: PAGE }),
    ).toEqual({
      kind: EDeepLinkPlan.NavigateInPage,
      path: '/sessions/s',
      url: 'http://127.0.0.1:4242/sessions/s',
    })
    expect(
      loadedPlanOf({
        link: deepLinkOf('atlas://open/settings/integrations'),
        pageUrl: PAGE,
        appUrl: PAGE,
      }).kind,
    ).toBe(EDeepLinkPlan.Focus)
  })
})

const windowOf = ({ pageUrl, loading = false }) => {
  const calls = []
  const handlers = new Map()
  return {
    calls,
    finishLoad: () => handlers.get('did-finish-load')?.(),
    isDestroyed: () => false,
    loadURL: async (url) => calls.push(`load ${url}`),
    webContents: {
      getURL: () => pageUrl,
      isLoading: () => loading,
      executeJavaScript: async (script) => calls.push(`run ${script}`),
      once: (name, handler) => handlers.set(name, handler),
    },
  }
}

describe('createDeepLinkOpener', () => {
  test('reveals the running window and routes the link inside it', () => {
    const win = windowOf({ pageUrl: PAGE })
    const open = createDeepLinkOpener({
      navigation,
      windowNow: () => win,
      createWindow: async () => undefined,
      reveal: () => win.calls.push('reveal'),
    })
    expect(open('atlas://open/sessions/ses_1')).toBe(true)
    expect(win.calls[0]).toBe('reveal')
    expect(win.calls[1]).toBe('navigate /sessions/ses_1')
  })

  test('opens a window on the link path when every window is closed', () => {
    const created = []
    const open = createDeepLinkOpener({
      navigation,
      windowNow: () => undefined,
      createWindow: async (options) => created.push(options),
      reveal: () => undefined,
    })
    open('atlas://open/settings')
    expect(created).toEqual([{ path: '/settings' }])
  })

  test('waits for a loading window, then routes inside the page', () => {
    const win = windowOf({ pageUrl: '', loading: true })
    const open = createDeepLinkOpener({
      navigation,
      windowNow: () => win,
      createWindow: async () => undefined,
      reveal: () => undefined,
    })
    open('atlas://open/sessions/s')
    expect(win.calls).toEqual([])
    win.webContents.getURL = () => PAGE
    win.finishLoad()
    expect(win.calls).toEqual(['navigate /sessions/s'])
  })

  test('ignores links it does not own', () => {
    const open = createDeepLinkOpener({
      navigation,
      windowNow: () => {
        throw new Error('must not touch a window')
      },
      createWindow: async () => undefined,
      reveal: () => undefined,
    })
    expect(open('https://example.com')).toBe(false)
  })
})

describe('protocolClientArgsOf', () => {
  test('registers the packaged app by its bundle', () => {
    expect(protocolClientArgsOf({ defaultApp: false, execPath: '/x', entry: '/a' })).toEqual([
      'atlas',
    ])
  })

  test('registers a dev run with electron and its entry script', () => {
    expect(
      protocolClientArgsOf({ defaultApp: true, execPath: '/electron', entry: '/repo/apps/mac' }),
    ).toEqual(['atlas', '/electron', ['/repo/apps/mac']])
    expect(protocolClientArgsOf({ defaultApp: true, execPath: '/electron' })).toBe(null)
  })
})
