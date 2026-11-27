import { EReturnSurface } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, describe, expect, it } from 'bun:test'

import { seedGroup, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { MCP_OAUTH_CALLBACK_PATH } from '../callback'
import { returnPathOf } from '../redirect'
import type { McpReturnTarget } from '../types'
import { answerOf, cookieOf, returnsOver, seedPending, tokenFetch } from './callback.fixture'
import { WEB_ORIGIN, restoreFetch, seedCloudServer } from './fixtures'

const testDb = useTestDatabase()

afterEach(restoreFetch)

const AUTHORIZE_URL = 'https://auth.example.com/authorize?state=state-1'

const seeded = async (args: { db?: Db; id?: string; target?: McpReturnTarget } = {}) => {
  const db = args.db ?? testDb().db
  await seedOwner(db)
  await seedCloudServer({ db, name: 'posthog' })
  await seedPending({
    db,
    id: args.id ?? 'state-1',
    mcpServerId: 'srv-posthog',
    ...(args.target === undefined ? {} : { target: args.target }),
  })
  return db
}

const startReturnOf = async (args: { db: Db; surface: EReturnSurface; port?: number }) => {
  const returns = returnsOver(args.db)
  await returns.begin({
    flow: 'mcp',
    state: 'state-1',
    providerUrl: AUTHORIZE_URL,
    callbackPath: MCP_OAUTH_CALLBACK_PATH,
    webPath: returnPathOf({ kind: 'session', id: 'ses_1' }),
  })
  return await returns.start({ state: 'state-1', surface: args.surface, port: args.port })
}

describe('the mcp sign-in return', () => {
  it('returns to the web session the flow started from', async () => {
    const db = await seeded()
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-1&code=code-1' })

    expect(answer.status).toBe(302)
    const location = new URL(answer.location)
    expect(location.origin).toBe(WEB_ORIGIN)
    expect(location.pathname).toBe('/sessions/ses_1')
    expect(location.searchParams.get('atlasReturn')).toBe('connected')
    expect(location.searchParams.get('atlasState')).toBe('state-1')
  })

  it('hands an ios session flow back to the app', async () => {
    const db = await seeded()
    tokenFetch()

    const answer = await answerOf({
      db,
      query: 'state=state-1&code=code-1',
      cookie: cookieOf({ state: 'state-1', surface: EReturnSurface.Ios }),
    })

    expect(answer.status).toBe(200)
    expect(answer.body).toContain(
      'atlas:///sessions/ses_1?atlasReturn=connected&atlasState=state-1',
    )
  })

  it('hands a desktop flow back to the app, with the web page as a fallback', async () => {
    const db = await seeded()
    tokenFetch()

    const answer = await answerOf({
      db,
      query: 'state=state-1&code=code-1',
      cookie: cookieOf({ state: 'state-1', surface: EReturnSurface.Desktop }),
    })

    expect(answer.status).toBe(200)
    expect(answer.body).toContain(
      'atlas://open/sessions/ses_1?atlasReturn=connected&atlasState=state-1',
    )
    expect(answer.body).toContain('Continue in the browser')
    expect(answer.body).toContain(WEB_ORIGIN)
  })

  it('answers the loopback listener the tui opened', async () => {
    const db = await seeded()
    tokenFetch()

    const answer = await answerOf({
      db,
      query: 'state=state-1&code=code-1',
      cookie: cookieOf({ state: 'state-1', surface: EReturnSurface.Tui, port: 43117 }),
    })

    expect(answer.status).toBe(302)
    const location = new URL(answer.location)
    expect(location.origin).toBe('http://127.0.0.1:43117')
    expect(location.pathname).toBe('/atlas-return')
    expect(location.searchParams.get('atlasReturn')).toBe('connected')
    expect(location.searchParams.get('atlasState')).toBe('state-1')
  })

  it('falls back to the surface the start link recorded when the browser lost the cookie', async () => {
    const db = await seeded()
    await startReturnOf({ db, surface: EReturnSurface.Ios })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-1&code=code-1' })

    expect(answer.status).toBe(200)
    expect(answer.body).toContain('atlas:///sessions/ses_1?atlasReturn=connected')
  })

  it('ignores a return cookie sealed for another sign-in', async () => {
    const db = await seeded()
    tokenFetch()

    const answer = await answerOf({
      db,
      query: 'state=state-1&code=code-1',
      cookie: cookieOf({ state: 'state-other', surface: EReturnSurface.Ios }),
    })

    expect(answer.status).toBe(302)
    expect(new URL(answer.location).origin).toBe(WEB_ORIGIN)
  })

  it('clears the return cookie on the callback path so the browser forgets the surface', async () => {
    const db = await seeded()
    await startReturnOf({ db, surface: EReturnSurface.Web })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-1&code=code-1' })

    expect(answer.setCookie).toContain('atlas_return=; Max-Age=0')
    expect(answer.setCookie).toContain(`Path=${MCP_OAUTH_CALLBACK_PATH}`)
  })

  it('keeps the legacy params for the project settings page', async () => {
    const db = await seeded({
      target: { surface: 'web', screen: { kind: 'settings', scope: 'project', id: 'proj_9' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-1&code=code-1' })

    const location = new URL(answer.location)
    expect(location.pathname).toBe('/projects/proj_9/settings/mcp')
    expect(location.searchParams.get('mcpOauth')).toBe('connected')
  })

  it('keeps a group settings flow on its page', async () => {
    const db = await seeded({
      target: { surface: 'web', screen: { kind: 'settings', scope: 'group', id: 'grp-1' } },
    })
    await seedGroup(db)
    await db.orm.public.McpServer.where({ id: 'srv-posthog' }).updateAndCount({
      userId: null,
      groupId: 'grp-1',
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-1&code=code-1' })

    expect(new URL(answer.location).pathname).toBe('/groups/grp-1/settings/mcp')
  })

  it('keeps an ios settings flow on the web page, which the app has no route for', async () => {
    const db = await seeded({
      target: { surface: 'ios', screen: { kind: 'settings', scope: 'user' } },
    })
    tokenFetch()

    const answer = await answerOf({ db, query: 'state=state-1&code=code-1' })

    expect(answer.status).toBe(302)
    expect(new URL(answer.location).pathname).toBe('/settings/integrations')
  })
})
