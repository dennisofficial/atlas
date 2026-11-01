import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { as, createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../../platform/sandboxes/token-principal'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import { SandboxConfigRouter } from '../scoped-config/sandbox-config.router'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { ProjectWorkspaceRouter } from './project-workspace.router'
import { ProjectsRouter } from './projects.router'
import { ProjectsService } from './projects.service'

const RATE_LIMIT = 3
const CALLS = RATE_LIMIT * 3
const SANDBOX_TOKEN = 'sbx-token'
const POD_TOKEN = 'pod-token'

const workspace = {
  projectId: 'p1',
  repo: null,
  baseBranch: null,
  additionalRepos: [],
  githubToken: null,
}
const emptyConfig = {
  settings: {},
  secrets: [],
  harnessSecrets: [],
  mcpServers: [],
  provenance: {},
}

describe('throttle opt-out on the serve-facing routes', () => {
  useTestDatabase()
  let app: INestApplication

  const get = (args: { path: string; token: string; input?: object }) => {
    const query =
      args.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(args.input))}`
    return fetch(`${baseUrl}/v1/trpc/${args.path}${query}`, { headers: as(args.token) })
  }
  let baseUrl = ''

  const statusesOf = async (args: { path: string; token: string; input?: object }) => {
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
        SandboxConfigRouter,
        SessionMiddleware,
        SessionOrSandboxMiddleware,
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
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              if (args.token === POD_TOKEN) {
                return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'user-a' }
              }
              if (args.token === SANDBOX_TOKEN) {
                return {
                  kind: ETokenPrincipalKind.Sandbox,
                  id: 'sbx-1',
                  threadId: 'thr-1',
                  userId: 'user-a',
                }
              }
              throw new UnauthorizedException()
            },
            async assertThreadInFamily() {
              throw new Error('no route in this app takes a threadId')
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
    const statuses = await statusesOf({ path: 'projects.list', token: 'session-a' })

    expect(statuses.slice(0, RATE_LIMIT).every((status) => status === 200)).toBe(true)
    expect(statuses).toContain(429)
  })

  it('never throttles projectWorkspace.get, for a pod or a sandbox token', async () => {
    const input = { projectId: 'p1' }

    for (const token of [POD_TOKEN, SANDBOX_TOKEN]) {
      const statuses = await statusesOf({ path: 'projectWorkspace.get', token, input })
      expect(statuses.every((status) => status === 200)).toBe(true)
    }
  })

  it('never throttles sandboxConfig.get, for a pod or a sandbox token', async () => {
    for (const token of [POD_TOKEN, SANDBOX_TOKEN]) {
      const statuses = await statusesOf({ path: 'sandboxConfig.get', token })
      expect(statuses.every((status) => status === 200)).toBe(true)
    }
  })
})
