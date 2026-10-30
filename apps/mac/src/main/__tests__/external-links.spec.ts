import { describe, expect, test } from 'bun:test'
import {
  decideNavigation,
  ENavigationTarget,
  navigationRulesFor,
  navigationUrlOf,
} from '../external-links'
import { routeExternalLinks } from '../external-links-wiring'

const hostOrigin = 'http://127.0.0.1:4100'
const decide = (url: string) => decideNavigation({ url, hostOrigin })

describe('decideNavigation', () => {
  test('keeps host origin and about:blank in-app', () => {
    expect(decide('http://127.0.0.1:4100/settings?x=1')).toBe(ENavigationTarget.InApp)
    expect(decide('about:blank')).toBe(ENavigationTarget.InApp)
  })
  test('sends everything else external', () => {
    for (const url of [
      'https://github.com/o/r/pull/1',
      'http://127.0.0.1:4101/',
      'http://localhost:4100/',
      'mailto:a@b.co',
      'not a url',
    ])
      expect(decide(url)).toBe(ENavigationTarget.External)
  })
})

describe('navigationUrlOf', () => {
  test('reads string and object payloads', () => {
    expect(navigationUrlOf({ data: { detail: '{"url":"https://a.co","allowed":false}' } })).toBe(
      'https://a.co',
    )
    expect(navigationUrlOf({ data: { detail: { url: 'https://b.co' } } })).toBe('https://b.co')
    expect(navigationUrlOf({ data: { detail: 'junk' } })).toBeNull()
    expect(navigationUrlOf(null)).toBeNull()
  })
})

describe('routeExternalLinks', () => {
  test('installs rules, opens external once, loads in-app popups', () => {
    const opened: string[] = []
    const loaded: string[] = []
    let rules: string[] = []
    let willNavigate: (e: unknown) => void = () => {}
    let newWindow: (e: unknown) => void = () => {}
    routeExternalLinks({
      webview: {
        setNavigationRules: (r) => void (rules = r),
        on: (_name, h) => void (willNavigate = h),
        loadURL: (u) => void loaded.push(u),
      },
      onNewWindow: (h) => void (newWindow = h),
      hostOrigin,
      openExternal: (u) => void opened.push(u),
      now: () => 0,
    })
    expect(rules).toEqual(navigationRulesFor({ hostOrigin }))
    const gh = { data: { detail: { url: 'https://github.com/o/r' } } }
    willNavigate({ data: { detail: '{"url":"https://github.com/o/r","allowed":false}' } })
    newWindow(gh)
    newWindow({ data: { detail: { url: `${hostOrigin}/x` } } })
    willNavigate({ data: { detail: `{"url":"${hostOrigin}/y","allowed":true}` } })
    expect(opened).toEqual(['https://github.com/o/r'])
    expect(loaded).toEqual([`${hostOrigin}/x`])
  })

  test('allows preview frame origins in-app while new windows still open externally', () => {
    const opened: string[] = []
    let rules: string[] = []
    let willNavigate: (e: unknown) => void = () => {}
    let newWindow: (e: unknown) => void = () => {}
    let clock = 0
    const router = routeExternalLinks({
      webview: {
        setNavigationRules: (r) => void (rules = r),
        on: (_name, h) => void (willNavigate = h),
        loadURL: () => undefined,
      },
      onNewWindow: (h) => void (newWindow = h),
      hostOrigin,
      openExternal: (u) => void opened.push(u),
      now: () => clock,
    })
    const preview = 'https://sb-1.vercel.run'
    router.setFrameOrigins([preview, preview])
    expect(rules).toEqual(['^*', `${hostOrigin}/*`, `${preview}/*`, 'about:blank'])
    willNavigate({ data: { detail: `{"url":"${preview}/","allowed":true}` } })
    expect(opened).toEqual([])
    newWindow({ data: { detail: { url: `${preview}/` } } })
    expect(opened).toEqual([`${preview}/`])
    clock = 5000
    router.setFrameOrigins([])
    expect(rules).toEqual(navigationRulesFor({ hostOrigin }))
    willNavigate({ data: { detail: `{"url":"${preview}/","allowed":false}` } })
    expect(opened).toEqual([`${preview}/`, `${preview}/`])
  })
})

describe('navigationRulesFor', () => {
  test('allow-lists frame origins with a path wildcard after the host', () => {
    expect(navigationRulesFor({ hostOrigin, frameOrigins: ['http://localhost:3000'] })).toEqual([
      '^*',
      `${hostOrigin}/*`,
      'http://localhost:3000/*',
      'about:blank',
    ])
  })

  test('decideNavigation keeps frame origins in-app', () => {
    expect(
      decideNavigation({
        url: 'http://localhost:3000/a',
        hostOrigin,
        frameOrigins: ['http://localhost:3000'],
      }),
    ).toBe(ENavigationTarget.InApp)
  })
})
