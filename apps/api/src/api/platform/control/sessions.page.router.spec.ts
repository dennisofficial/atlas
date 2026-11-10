import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import request from 'supertest'
import { seedThreadRow, seedUsers, STAMP, USER_A } from '../../../../test/session-seed'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createMixedApp } from '../accounts/accounts.router.fixture'
import { pageSessions } from '../sessions/session-pages'
import { SessionsRouter } from './sessions.router'
import { SessionsService } from './sessions.service'

const HOUR_MS = 60 * 60 * 1000

const seedArchived = (args: { id: string; title: string; at: number }): Promise<unknown> =>
  seedThreadRow({
    id: args.id,
    userId: USER_A,
    title: args.title,
    archivedAt: STAMP,
    updatedAt: new Date(args.at),
  })

describe('sessions.page', () => {
  useTestDatabase()

  let app: NestExpressApplication

  const page = (input: object, token: string | null = 'session-a') => {
    const sent = request(app.getHttpServer())
      .get('/v1/trpc/sessions.page')
      .query({ input: JSON.stringify(input) })
    return (token === null ? sent : sent.set(as(token))).send()
  }

  beforeAll(async () => {
    app = await createMixedApp({
      providers: [
        SessionsRouter,
        SessionMiddleware,
        { provide: SessionsService, useValue: { page: pageSessions } },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer session-a') return null
              return { userId: USER_A, sessionId: 'ses', email: '' }
            },
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('walks every archived page once without repeating a row', async () => {
    const now = STAMP.getTime()
    const titles = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
    for (const [index, title] of titles.entries()) {
      await seedArchived({ id: `archived_${title}`, title, at: now - index * HOUR_MS })
    }
    await seedThreadRow({ id: 'inactive_one', userId: USER_A, title: 'stale', updatedAt: STAMP })

    const first = await page({ bucket: 'archived', limit: 2 })
    expect(first.status).toBe(200)
    const firstPage: { rows: { sessionId: string }[]; counts: object; next?: string } =
      first.body.result.data
    expect(firstPage.rows).toHaveLength(2)
    expect(firstPage.counts).toEqual({ active: 0, inactive: 1, archived: 5 })
    expect(firstPage.next).toBeString()

    const second = await page({ bucket: 'archived', limit: 2, cursor: firstPage.next })
    const secondPage: { rows: { sessionId: string }[]; next?: string } = second.body.result.data
    expect(secondPage.rows).toHaveLength(2)

    const third = await page({ bucket: 'archived', limit: 2, cursor: secondPage.next })
    const thirdPage: { rows: { sessionId: string }[]; next?: string } = third.body.result.data
    expect(thirdPage.rows).toHaveLength(1)
    expect(thirdPage.next).toBeUndefined()

    const seen = [...firstPage.rows, ...secondPage.rows, ...thirdPage.rows].map(
      (row) => row.sessionId,
    )
    expect(new Set(seen).size).toBe(titles.length)
  })

  it('filters the page by title, ignoring case and escaping LIKE metacharacters', async () => {
    const now = STAMP.getTime()
    await seedArchived({ id: 'parser', title: 'Fix the Parser bug', at: now })
    await seedArchived({ id: 'coverage', title: 'Investigate 100% coverage', at: now - HOUR_MS })
    await seedArchived({ id: 'branches', title: 'Merge 100 branches', at: now - 2 * HOUR_MS })

    const found = await page({ bucket: 'archived', search: 'parser' })
    expect(found.body.result.data.rows.map((row: { sessionId: string }) => row.sessionId)).toEqual([
      'ses_parser',
    ])

    const escaped = await page({ bucket: 'archived', search: '100%' })
    expect(
      escaped.body.result.data.rows.map((row: { sessionId: string }) => row.sessionId),
    ).toEqual(['ses_coverage'])
    expect(escaped.body.result.data.counts).toEqual({ active: 0, inactive: 0, archived: 1 })

    const underscore = await page({ bucket: 'archived', search: '_ar' })
    expect(underscore.body.result.data.rows).toHaveLength(0)
  })

  it('rejects an unauthenticated caller', async () => {
    const response = await page({ bucket: 'archived' }, null)
    expect(response.status).toBe(401)
  })
})
