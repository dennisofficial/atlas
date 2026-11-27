import { describe, expect, it } from 'bun:test'
import { EReturnResult } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { cipher } from '../../config/__tests__/config-reader.fixture'
import { BrowserReturnService, type BrowserReturnServiceArgs } from '../service'
import { BrowserReturnStore } from '../store'

const testDb = useTestDatabase()

const NOW = new Date('2026-11-27T12:00:00.000Z')
const PROVIDER_URL = 'https://mcp.example.com/authorize?state=pkce-1'
const CALLBACK_PATH = '/mcp-oauth/callback'
const WEB_PATH = '/settings/integrations'
const OTHER_KEY = 'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const CONNECTED = { result: EReturnResult.Connected }
const FAILED = { result: EReturnResult.Failed, reason: 'the provider said no' }

const serviceOf = (over: Partial<BrowserReturnServiceArgs> = {}): BrowserReturnService =>
  new BrowserReturnService({
    db: testDb().db,
    cipher,
    publicUrl: 'https://api.byatlas.io/v1',
    webOrigin: 'https://byatlas.io',
    now: () => NOW,
    ...over,
  })

const beginOf = (
  service: BrowserReturnService,
  args: { state?: string; ttlMs?: number } = {},
): Promise<{ startUrl: string; expiresAt: Date }> =>
  service.begin({
    flow: 'mcp',
    state: args.state ?? 'state-1',
    providerUrl: PROVIDER_URL,
    callbackPath: CALLBACK_PATH,
    webPath: WEB_PATH,
    ttlMs: args.ttlMs,
  })

const rowOf = (state = 'state-1') => testDb().db.orm.public.BrowserReturnPending.first({ state })

const sealedCookieOf = (args: { cipher: SecretCipher; body: unknown }): string =>
  `atlas_return=${encodeURIComponent(args.cipher.encrypt(JSON.stringify(args.body)))}`

const cookieBodyOf = (setCookie: string): unknown => {
  const raw = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'))
  return JSON.parse(cipher.decrypt(decodeURIComponent(raw)))
}

describe('BrowserReturnService.begin', () => {
  it('seals the provider url and links the start on the public origin', async () => {
    const begun = await beginOf(serviceOf())

    expect(begun.startUrl).toBe('https://api.byatlas.io/return/start/state-1')
    expect(begun.expiresAt.toISOString()).toBe('2026-11-27T12:10:00.000Z')
    const row = await rowOf()
    if (row === null) throw new Error('the return row was not stored')
    expect(row.flow).toBe('mcp')
    expect(row.callbackPath).toBe(CALLBACK_PATH)
    expect(row.webPath).toBe(WEB_PATH)
    expect(row.surface).toBe('web')
    expect(row.providerUrlSealed).not.toContain('mcp.example.com')
    expect(cipher.decrypt(row.providerUrlSealed)).toContain(PROVIDER_URL)
  })

  it('drops the rows that already expired', async () => {
    const store = new BrowserReturnStore(testDb().db)
    await store.insert({
      state: 'state-old',
      flow: 'mcp',
      userId: null,
      surface: 'web',
      port: null,
      providerUrlSealed: cipher.encrypt(JSON.stringify({ providerUrl: PROVIDER_URL })),
      callbackPath: CALLBACK_PATH,
      webPath: WEB_PATH,
      expiresAt: new Date('2026-11-27T11:00:00.000Z'),
    })

    await beginOf(serviceOf())

    expect(await rowOf('state-old')).toBeNull()
  })
})

describe('BrowserReturnService.start', () => {
  it('sends the browser to the provider with a sealed cookie scoped to the callback', async () => {
    const service = serviceOf()
    await beginOf(service)

    const answer = await service.start({ state: 'state-1', surface: 'ios', port: '53682' })

    if (answer.kind !== 'redirect') throw new Error('an open link must redirect')
    expect(answer.location).toBe(PROVIDER_URL)
    expect(answer.cookie).toContain(`Path=${CALLBACK_PATH}`)
    expect(answer.cookie).toContain('HttpOnly')
    expect(answer.cookie).toContain('Secure')
    expect(answer.cookie).toContain('SameSite=Lax')
    expect(answer.cookie).toContain('Max-Age=600')
    expect(cookieBodyOf(answer.cookie)).toEqual({ state: 'state-1', surface: 'ios' })
    const row = await rowOf()
    expect(row?.surface).toBe('ios')
    expect(row?.port).toBeNull()
  })

  it('records the surface and the loopback port of a terminal', async () => {
    const service = serviceOf()
    await beginOf(service)

    const answer = await service.start({ state: 'state-1', surface: 'tui', port: '53682' })

    if (answer.kind !== 'redirect') throw new Error('an open link must redirect')
    expect(cookieBodyOf(answer.cookie)).toEqual({
      state: 'state-1',
      surface: 'tui',
      port: 53682,
    })
    const row = await rowOf()
    expect(row?.surface).toBe('tui')
    expect(row?.port).toBe(53682)
  })

  it('answers an unknown link as gone', async () => {
    const answer = await serviceOf().start({ state: 'state-nope' })

    expect(answer.kind).toBe('gone')
    expect(answer.kind === 'gone' ? answer.html : '').toContain('expired')
  })

  it('answers an expired link as gone', async () => {
    await beginOf(serviceOf(), { ttlMs: 1000 })

    const answer = await serviceOf({ now: () => new Date(NOW.getTime() + 60_000) }).start({
      state: 'state-1',
    })

    expect(answer.kind).toBe('gone')
  })
})

describe('BrowserReturnService.answer', () => {
  it('follows a sealed cookie for the same state into the ios app', async () => {
    await beginOf(serviceOf())

    const answer = await serviceOf().answer({
      state: 'state-1',
      cookieHeader: sealedCookieOf({
        cipher,
        body: { state: 'state-1', surface: 'ios' },
      }),
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })

    if (answer.kind !== 'page') throw new Error('the ios app needs the deep-link page')
    expect(answer.html).toContain('atlas:///settings/integrations?atlasReturn=connected')
    expect(answer.html).toContain('atlasState=state-1')
    expect(answer.html).toContain('https://byatlas.io/settings/integrations?')
  })

  it('falls back to the recorded target without a cookie', async () => {
    const service = serviceOf()
    await beginOf(service)
    await service.start({ state: 'state-1', surface: 'desktop' })

    const answer = await service.answer({
      state: 'state-1',
      cookieHeader: undefined,
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })

    if (answer.kind !== 'page') throw new Error('the mac app needs the deep-link page')
    expect(answer.html).toContain('atlas://open/settings/integrations?atlasReturn=connected')
  })

  it('ignores a cookie another secret sealed', async () => {
    await beginOf(serviceOf())

    const answer = await serviceOf().answer({
      state: 'state-1',
      cookieHeader: sealedCookieOf({
        cipher: new SecretCipher(OTHER_KEY),
        body: { state: 'state-1', surface: 'ios' },
      }),
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })

    if (answer.kind !== 'redirect') throw new Error('a web target must redirect')
    expect(answer.location).toBe(
      'https://byatlas.io/settings/integrations?atlasReturn=connected&atlasState=state-1',
    )
  })

  it('redirects the terminal to its loopback listener', async () => {
    const service = serviceOf()
    await beginOf(service)
    await service.start({ state: 'state-1', surface: 'tui', port: '53682' })

    const answer = await service.answer({
      state: 'state-1',
      cookieHeader: undefined,
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })

    if (answer.kind !== 'redirect') throw new Error('the terminal must be redirected')
    expect(answer.location).toBe(
      'http://127.0.0.1:53682/atlas-return?atlasReturn=connected&atlasState=state-1',
    )
  })

  it('carries a refusal back to the web page with its reason', async () => {
    await beginOf(serviceOf())

    const answer = await serviceOf().answer({
      state: 'state-1',
      cookieHeader: undefined,
      outcome: FAILED,
      fallbackWebPath: '/fallback',
    })

    if (answer.kind !== 'redirect') throw new Error('a web target must redirect')
    expect(answer.location).toContain('atlasReturn=failed')
    expect(answer.location).toContain('atlasReason=the+provider+said+no')
  })

  it('answers an unknown state on the web fallback path', async () => {
    const answer = await serviceOf().answer({
      state: 'state-nope',
      cookieHeader: undefined,
      outcome: CONNECTED,
      fallbackWebPath: '/sessions/ses_1',
    })

    if (answer.kind !== 'redirect') throw new Error('a web target must redirect')
    expect(answer.location).toBe(
      'https://byatlas.io/sessions/ses_1?atlasReturn=connected&atlasState=state-nope',
    )
  })

  it('clears the cookie on its own path and takes the row once', async () => {
    await beginOf(serviceOf())

    const first = await serviceOf().answer({
      state: 'state-1',
      cookieHeader: undefined,
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })
    const second = await serviceOf().answer({
      state: 'state-1',
      cookieHeader: undefined,
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })

    expect(first.clearCookie).toBe(
      `atlas_return=; Max-Age=0; Path=${CALLBACK_PATH}; HttpOnly; Secure; SameSite=Lax`,
    )
    if (first.kind !== 'redirect' || second.kind !== 'redirect')
      throw new Error('both answers must redirect')
    expect(first.location).toContain('/settings/integrations?')
    expect(second.location).toContain('/fallback?')
    expect(await rowOf()).toBeNull()
  })

  it('hands the row to one of two callbacks that race', async () => {
    await beginOf(serviceOf())
    const answerOnce = () =>
      serviceOf().answer({
        state: 'state-1',
        cookieHeader: undefined,
        outcome: CONNECTED,
        fallbackWebPath: '/fallback',
      })

    const answers = await Promise.all([answerOnce(), answerOnce(), answerOnce()])

    const located = answers.map((answer) => (answer.kind === 'redirect' ? answer.location : ''))
    expect(located.filter((location) => location.includes('/settings/integrations?'))).toHaveLength(
      1,
    )
  })

  it('answers an expired row on the fallback path', async () => {
    const service = serviceOf()
    await beginOf(service)
    await service.start({ state: 'state-1', surface: 'desktop' })

    const answer = await serviceOf({ now: () => new Date(NOW.getTime() + 60 * 60_000) }).answer({
      state: 'state-1',
      cookieHeader: undefined,
      outcome: CONNECTED,
      fallbackWebPath: '/fallback',
    })

    if (answer.kind !== 'redirect') throw new Error('an expired row must fall back to the web')
    expect(answer.location).toContain('https://byatlas.io/fallback?')
  })
})
