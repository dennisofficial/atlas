import { describe, expect, it } from 'bun:test'

import { callbackAnswerOf, returnPathOf, surfaceOf } from '../redirect'

const WEB_ORIGIN = 'https://app.byatlas.io'

describe('returnPathOf', () => {
  it('names the session screen', () => {
    expect(returnPathOf({ kind: 'session', id: 'ses_1' })).toBe('/sessions/ses_1')
  })

  it('names the user settings page', () => {
    expect(returnPathOf({ kind: 'settings', scope: 'user' })).toBe('/settings/integrations')
  })

  it('names a project MCP settings page', () => {
    expect(returnPathOf({ kind: 'settings', scope: 'project', id: 'proj_1' })).toBe(
      '/projects/proj_1/settings/mcp',
    )
  })

  it('escapes an id rather than letting it move the path', () => {
    expect(returnPathOf({ kind: 'session', id: '../settings' })).toBe('/sessions/..%2Fsettings')
  })
})

describe('callbackAnswerOf', () => {
  it('sends the web to the screen with the result params', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'web', screen: { kind: 'session', id: 'ses_1' } },
      serverUrl: 'https://mcp.example.com/mcp',
    })

    expect(answer.kind).toBe('redirect')
    if (answer.kind !== 'redirect') return
    const url = new URL(answer.location)
    expect(url.origin).toBe(WEB_ORIGIN)
    expect(url.pathname).toBe('/sessions/ses_1')
    expect(url.searchParams.get('mcpOauth')).toBe('connected')
    expect(url.searchParams.get('mcpServer')).toBe('https://mcp.example.com/mcp')
  })

  it('reports a failure with its reason', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'web', screen: { kind: 'settings', scope: 'user' } },
      reason: 'expired',
    })

    expect(answer.kind).toBe('redirect')
    if (answer.kind !== 'redirect') return
    const url = new URL(answer.location)
    expect(url.pathname).toBe('/settings/integrations')
    expect(url.searchParams.get('mcpOauth')).toBe('failed')
    expect(url.searchParams.get('mcpReason')).toBe('expired')
  })

  it('fires the desktop deep link and keeps the web page as the fallback', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'desktop', screen: { kind: 'settings', scope: 'project', id: 'proj_1' } },
    })

    expect(answer.kind).toBe('page')
    if (answer.kind !== 'page') return
    expect(answer.html).toContain('atlas://open/projects/proj_1/settings/mcp?mcpOauth=connected')
    expect(answer.html).toContain(`${WEB_ORIGIN}/projects/proj_1/settings/mcp?mcpOauth=connected`)
  })

  it('fires the ios deep link for a session', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'ios', screen: { kind: 'session', id: 'ses_1' } },
    })

    expect(answer.kind).toBe('page')
    if (answer.kind !== 'page') return
    expect(answer.html).toContain('atlas:///sessions/ses_1?mcpOauth=connected')
  })

  it('keeps an ios settings flow in the browser', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'ios', screen: { kind: 'settings', scope: 'user' } },
    })

    expect(answer.kind).toBe('redirect')
  })

  it('escapes a reason that would otherwise be markup', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'desktop', screen: { kind: 'session', id: 'ses_1' } },
      reason: '<script>alert(1)</script>',
    })

    expect(answer.kind).toBe('page')
    if (answer.kind !== 'page') return
    expect(answer.html).not.toContain('<script>alert(1)</script>')
    expect(answer.html).toContain('&lt;script&gt;')
  })

  it('drops a reason longer than the parameter allows', () => {
    const answer = callbackAnswerOf({
      webOrigin: WEB_ORIGIN,
      target: { surface: 'web', screen: { kind: 'settings', scope: 'user' } },
      reason: 'x'.repeat(400),
    })

    if (answer.kind !== 'redirect') throw new Error('expected a redirect')
    expect(new URL(answer.location).searchParams.get('mcpReason')?.length).toBe(200)
  })
})

describe('surfaceOf', () => {
  it('reads the stored surface and defaults to the web', () => {
    expect(surfaceOf('desktop')).toBe('desktop')
    expect(surfaceOf('ios')).toBe('ios')
    expect(surfaceOf('web')).toBe('web')
    expect(surfaceOf(null)).toBe('web')
    expect(surfaceOf('elsewhere')).toBe('web')
  })
})
