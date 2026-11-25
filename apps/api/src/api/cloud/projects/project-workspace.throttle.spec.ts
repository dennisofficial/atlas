import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { type INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { as, createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ProjectWorkspaceRouter } from './project-workspace.router'
import { ProjectsRouter } from './projects.router'
import { ProjectsService } from './projects.service'

const RATE_LIMIT = 3
const CALLS = RATE_LIMIT * 3
const SESSION = 'session-a'

const workspace = {
  projectId: 'p1',
  repo: null,
  baseBranch: null,
  additionalRepos: [],
  githubToken: null,
}

describe('throttle opt-out on the workspace route', () => {
  useTestDatabase()
  let app: INestApplication

  const get = (args: { path: string; input?: object }) => {
    const query =
      args.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(args.input))}`
    return fetch(`${baseUrl}/v1/trpc/${args.path}${query}`, { headers: as(SESSION) })
  }
  let baseUrl = ''

  const statusesOf = async (args: { path: string; input?: object }) => {
    const statuses: number[] = []
    for (let call = 0; call < CALLS; call += 1) statuses.push((await get(args)).status)
    return statuses
  }

  beforeEach(async () => {
    await seedSessionUsers()
    await seedThread({ db, id: 'thr-1', userId: 'user-a' })
    app = await createMiddlewareApp({
      rateLimit: RATE_LIMIT,
      providers: [
        ProjectsRouter,
        ProjectWorkspaceRouter,
        SessionMiddleware,
        {
          provide: ProjectsService,
          useValue: { list: async () => [], workspace: async () => workspace },
        },
        { provide: ScopedConfigService, useValue: { resolveForPod: async () => emptyConfig } },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify() {
              return { userId: 'user-a', sessionId: 'ses', email: '' }
            },
          },
        },
      ],
    })
    await app.listen(0)
    baseUrl = await app.getUrl()
  })

  afterEach(() => app.close())

  it('throttles an ordinary route once the limit is spent', async () => {
    const statuses = await statusesOf({ path: 'projects.list' })

    expect(statuses.slice(0, RATE_LIMIT).every((status) => status === 200)).toBe(true)
    expect(statuses).toContain(429)
  })

  it('never throttles projectWorkspace.get', async () => {
    const statuses = await statusesOf({ path: 'projectWorkspace.get', input: { projectId: 'p1' } })

    expect(statuses.every((status) => status === 200)).toBe(true)
  })
})
