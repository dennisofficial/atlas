import { describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { NEW_TAB_URL } from '../browser-model'
import { resolveAddress } from '../resolve-address'

const WEB: PreviewPort = {
  id: 'service:web',
  port: 3000,
  label: 'Web',
  url: 'https://3000-abcdefghij.byatlas.dev/',
  status: EPreviewStatus.Live,
}
const STORYBOOK: PreviewPort = {
  id: 'service:sb',
  port: 6006,
  label: 'Storybook',
  url: 'https://6006-abcdefghij.byatlas.dev/',
  status: EPreviewStatus.Live,
}
const API: PreviewPort = {
  id: 'service:api',
  port: 4000,
  label: 'API',
  url: 'https://4000-abcdefghij.byatlas.dev/',
  status: EPreviewStatus.Stopped,
}
const PORTS = [API, WEB, STORYBOOK]
const CALLBACK = 'https://callback.byatlas.dev/quickbooks/callback?code=c&state=abc'

const resolve = (input: string, extra: { currentUrl?: string; allowExternal?: boolean } = {}) =>
  resolveAddress({
    input,
    currentUrl: extra.currentUrl ?? NEW_TAB_URL,
    ports: PORTS,
    allowExternal: extra.allowExternal ?? false,
  })

describe('resolveAddress', () => {
  it('rejects empty and whitespace input', () => {
    expect(resolve('')).toBeNull()
    expect(resolve('   ')).toBeNull()
    expect(resolve('a b')).toBeNull()
  })

  it('resolves a bare port or :port to that preview origin', () => {
    expect(resolve('3000')).toBe('https://3000-abcdefghij.byatlas.dev/')
    expect(resolve(':6006')).toBe('https://6006-abcdefghij.byatlas.dev/')
    expect(resolve('3000/docs?x=1')).toBe('https://3000-abcdefghij.byatlas.dev/docs?x=1')
  })

  it('resolves localhost and loopback forms with a path', () => {
    expect(resolve('localhost:3000/x')).toBe('https://3000-abcdefghij.byatlas.dev/x')
    expect(resolve('http://127.0.0.1:6006/?path=/story')).toBe(
      'https://6006-abcdefghij.byatlas.dev/?path=/story',
    )
    expect(resolve('0.0.0.0:3000')).toBe('https://3000-abcdefghij.byatlas.dev/')
  })

  it('returns null for an unknown port unless external is allowed', () => {
    expect(resolve('9999')).toBeNull()
    expect(resolve('localhost:9999/x')).toBeNull()
    expect(resolve('localhost:9999/x', { allowExternal: true })).toBe('http://localhost:9999/x')
    expect(resolve('9999', { allowExternal: true })).toBe('http://localhost:9999/')
  })

  it('rejects out-of-range ports and single-digit numbers', () => {
    expect(resolve('99999')).toBeNull()
    expect(resolve('99999', { allowExternal: true })).toBeNull()
    expect(resolve('5')).toBeNull()
    expect(resolve('5', { allowExternal: true })).toBeNull()
  })

  it('resolves a path against the current tab preview origin', () => {
    expect(resolve('/x', { currentUrl: 'https://6006-abcdefghij.byatlas.dev/other' })).toBe(
      'https://6006-abcdefghij.byatlas.dev/x',
    )
    expect(resolve('/a?b=1', { currentUrl: WEB.url })).toBe(
      'https://3000-abcdefghij.byatlas.dev/a?b=1',
    )
  })

  it('falls back to the first live port for a path off a preview origin', () => {
    expect(resolve('/x')).toBe('https://3000-abcdefghij.byatlas.dev/x')
    expect(resolve('/x', { currentUrl: 'https://example.com/' })).toBe(
      'https://3000-abcdefghij.byatlas.dev/x',
    )
  })

  it('returns null for a path with no live port, and for protocol-relative input', () => {
    expect(
      resolveAddress({ input: '/x', currentUrl: NEW_TAB_URL, ports: [API], allowExternal: true }),
    ).toBeNull()
    expect(resolve('//evil.test/x', { allowExternal: true })).toBeNull()
  })

  it('resolves external hosts and urls only when allowed', () => {
    expect(resolve('example.com')).toBeNull()
    expect(resolve('https://example.com/a')).toBeNull()
    expect(resolve('example.com', { allowExternal: true })).toBe('https://example.com/')
    expect(resolve('http://example.com/a', { allowExternal: true })).toBe('http://example.com/a')
  })

  it('accepts preview-host urls without allowExternal', () => {
    expect(resolve('https://3000-abcdefghij.byatlas.dev/pricing')).toBe(
      'https://3000-abcdefghij.byatlas.dev/pricing',
    )
    expect(resolve('3000-abcdefghij.byatlas.dev/pricing')).toBe(
      'https://3000-abcdefghij.byatlas.dev/pricing',
    )
  })

  it('rejects non-web schemes', () => {
    expect(resolve('javascript:alert(1)', { allowExternal: true })).toBeNull()
    expect(resolve('ftp://example.com', { allowExternal: true })).toBeNull()
  })

  it('sends a provider callback to the preview the sign-in started in', () => {
    expect(resolve(CALLBACK)).toBe(
      'https://3000-abcdefghij.byatlas.dev/quickbooks/callback?code=c&state=abc',
    )
    expect(
      resolve('callback.byatlas.dev/quickbooks/callback?error=access_denied', {
        currentUrl: 'https://6006-abcdefghij.byatlas.dev/?path=/story/button',
      }),
    ).toBe('https://6006-abcdefghij.byatlas.dev/quickbooks/callback?error=access_denied')
  })

  it('leaves the callback handoff for the Mac app and a portless session alone', () => {
    const start = 'https://callback.byatlas.dev/__atlas/start?to=https%3A%2F%2Faccounts.google.com'
    expect(resolve(start, { allowExternal: true })).toBe(start)
    expect(
      resolveAddress({
        input: CALLBACK,
        currentUrl: NEW_TAB_URL,
        ports: [API],
        allowExternal: true,
      }),
    ).toBe(CALLBACK)
  })
})
