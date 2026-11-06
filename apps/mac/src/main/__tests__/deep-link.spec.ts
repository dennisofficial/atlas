import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DESKTOP_URL_SCHEME } from '@dltech/atlas-wire/web'

import { sessionLandingOf } from '../../host/guard'
import { deepLinkTargetOf, inAppPathOf, openUrlOf, previewCallbackPathOf } from '../deep-link'

const HOST = 'http://127.0.0.1:41234'

describe('inAppPathOf', () => {
  it('keeps the path and query of atlas://open links', () => {
    expect(
      inAppPathOf(
        'atlas://open/settings/integrations?mcpOauth=connected&mcpServer=https%3A%2F%2Fx%2F',
      ),
    ).toBe('/settings/integrations?mcpOauth=connected&mcpServer=https%3A%2F%2Fx%2F')
  })

  it('opens the app root for a bare open link', () => {
    expect(inAppPathOf('atlas://open')).toBe('/')
  })

  it('refuses other schemes, hosts and protocol-relative paths', () => {
    expect(inAppPathOf('https://open/settings')).toBeNull()
    expect(inAppPathOf('atlas://elsewhere/settings')).toBeNull()
    expect(inAppPathOf('atlas://open//evil.example/x')).toBeNull()
    expect(inAppPathOf('not a url')).toBeNull()
  })
})

describe('previewCallbackPathOf', () => {
  it('keeps the callback path and query of atlas://preview-callback links', () => {
    expect(
      previewCallbackPathOf('atlas://preview-callback/api/auth/callback/google?code=c&state=s'),
    ).toBe('/api/auth/callback/google?code=c&state=s')
  })

  it('refuses open links and protocol-relative paths', () => {
    expect(previewCallbackPathOf('atlas://open/settings')).toBeNull()
    expect(previewCallbackPathOf('atlas://preview-callback//evil.example/x')).toBeNull()
    expect(inAppPathOf('atlas://preview-callback/x')).toBeNull()
  })
})

describe('deepLinkTargetOf', () => {
  it('routes through the session start so the window keeps its cookie', () => {
    const target = new URL(
      deepLinkTargetOf({
        link: 'atlas://open/settings?mcpOauth=connected',
        hostUrl: HOST,
        secret: 's',
      }) ?? '',
    )
    expect(target.origin).toBe(HOST)
    expect(target.pathname).toBe('/desktop/session')
    expect(target.searchParams.get('secret')).toBe('s')
    expect(target.searchParams.get('next')).toBe('/settings?mcpOauth=connected')
  })
})

describe('sessionLandingOf', () => {
  it('lands on a same-origin next path, else the root', () => {
    expect(sessionLandingOf('/settings?x=1')).toBe('/settings?x=1')
    expect(sessionLandingOf(null)).toBe('/')
    expect(sessionLandingOf('//evil.example')).toBe('/')
    expect(sessionLandingOf('https://evil.example')).toBe('/')
    expect(sessionLandingOf('/\\evil.example')).toBe('/')
  })
})

describe('openUrlOf', () => {
  it('reads the url from an open-url event', () => {
    expect(openUrlOf({ data: { url: 'atlas://open/x' } })).toBe('atlas://open/x')
    expect(openUrlOf({ data: {} })).toBeNull()
    expect(openUrlOf(null)).toBeNull()
  })
})

describe('electrobun config', () => {
  it('registers the scheme the API redirects to', () => {
    const config = readFileSync(join(import.meta.dir, '../../../electrobun.config.ts'), 'utf8')
    expect(config).toContain(`urlSchemes: ['${DESKTOP_URL_SCHEME}']`)
  })
})
