import type { INestApplication } from '@nestjs/common'
import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_STALE_REVISION_CODE } from '@dltech/atlas-wire'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { sharedMemoryDb } = await import('./memories.fake-db')
  return { db: sharedMemoryDb.db as unknown as PrismaClient }
})

import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../../platform/sandboxes/token-principal'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { sharedMemoryDb as fake } from './memories.fake-db'
import { MemoriesController } from './memories.controller'
import { MemoriesService } from './memories.service'

const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
}
const SANDBOX_TOKENS: Record<string, { id: string; threadId: string; userId: string }> = {
  'sandbox-token-a': { id: 'sbx-a', threadId: 'thread-sbx-a', userId: 'user-a' },
}

const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get('plain')
  @UseGuards(SessionOrSandboxGuard)
  plain(): { ok: true } {
    return { ok: true }
  }

  @Get('session-only')
  @UseGuards(SessionAuthGuard)
  sessionOnly(): { ok: true } {
    return { ok: true }
  }
}

const NOTE = {
  scope: 'global',
  name: 'bun-deflate-is-raw-not-zlib',
  description: 'Bun deflate output is raw',
  type: 'reference',
  body: 'Raw deflate. **Why:** observed. **How to apply:** use inflateSync.',
}

describe('memories HTTP surface', () => {
  let app: INestApplication

  const http = () => request(app.getHttpServer())
  const as = (token: string) => ({ authorization: `Bearer ${token}` })
  const entry = (token: string) =>
    http().get('/v1/memories/entry').query({ scope: 'global', name: NOTE.name }).set(as(token))

  beforeEach(async () => {
    fake.reset()
    const module = await Test.createTestingModule({
      controllers: [MemoriesController, ProbeController],
      providers: [
        MemoriesService,
        SessionAuthGuard,
        SessionOrSandboxGuard,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = SESSIONS[bearerOf(req)]
              if (userId === undefined) return null
              return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              const pod = POD_TOKENS[args.token]
              if (pod !== undefined) return { kind: ETokenPrincipalKind.Pod, ...pod }
              const sandbox = SANDBOX_TOKENS[args.token]
              if (sandbox !== undefined) return { kind: ETokenPrincipalKind.Sandbox, ...sandbox }
              throw new UnauthorizedException()
            },
            async assertThreadInFamily() {
              throw new Error('a threadless memory route must never reach the thread-family check')
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    await app.init()
  })

  afterEach(() => app.close())

  it("a session writes and the same user's pod lease token reads it", async () => {
    const written = await http()
      .put('/v1/memories/entry')
      .set(as('session-a'))
      .send(NOTE)
      .expect(200)
    expect(written.body).toMatchObject({
      name: NOTE.name,
      scope: 'global',
      project: null,
      revision: 1,
    })

    const read = await entry('pod-token-a').expect(200)

    expect(read.headers['cache-control']).toBe('no-store')
    expect(read.body).toMatchObject({ name: NOTE.name, body: NOTE.body, revision: 1 })
  })

  it('a stale-revision PATCH is a 409 with the memory-stale-revision code', async () => {
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)
    await http()
      .put('/v1/memories/entry')
      .set(as('session-a'))
      .send({ ...NOTE, body: 'Raw deflate v2' })
      .expect(200)

    const stale = await http()
      .patch('/v1/memories/entry')
      .set(as('session-a'))
      .send({ scope: 'global', name: NOTE.name, old: 'v2', new: 'v3', revision: 1 })
      .expect(409)

    expect(stale.body.code).toBe(MEMORY_STALE_REVISION_CODE)
    expect(stale.body.message).toContain('revision 2')
  })

  it('a PATCH at the current revision applies and returns the next revision', async () => {
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)

    const edited = await http()
      .patch('/v1/memories/entry')
      .set(as('pod-token-a'))
      .send({ scope: 'global', name: NOTE.name, old: 'observed', new: 'measured', revision: 1 })
      .expect(200)

    expect(edited.body.revision).toBe(2)
    expect((await entry('session-a').expect(200)).body.body).toContain('measured')
  })

  it("another user's session gets 404 for the memory and cannot delete it", async () => {
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)

    await entry('session-b').expect(404)
    await http()
      .delete('/v1/memories/entry')
      .query({ scope: 'global', name: NOTE.name })
      .set(as('session-b'))
      .expect(404)
    await entry('session-a').expect(200)
  })

  it('a pod bearer is refused on a non-memory SessionOrSandboxGuard route and unauthorized on a session-only route', async () => {
    await http().get('/v1/probe/plain').set(as('pod-token-a')).expect(403)
    await http().get('/v1/probe/session-only').set(as('pod-token-a')).expect(401)
    await http().get('/v1/probe/session-only').set(as('session-a')).expect(200)
  })

  it('a sandbox principal can list its owner’s memories', async () => {
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)

    const listed = await http().get('/v1/memories').set(as('sandbox-token-a')).expect(200)

    expect(listed.body.memories.map((memory: { name: string }) => memory.name)).toEqual([NOTE.name])
  })

  it('lists project memories only when the project is named, lowercased', async () => {
    const projectNote = { ...NOTE, scope: 'project', project: 'acme/widgets', name: 'widget-fact' }
    await http().put('/v1/memories/entry').set(as('session-a')).send(projectNote).expect(200)

    const without = await http().get('/v1/memories').set(as('pod-token-a')).expect(200)
    const withProject = await http()
      .get('/v1/memories')
      .query({ project: 'Acme/Widgets' })
      .set(as('pod-token-a'))
      .expect(200)

    expect(without.body.memories).toEqual([])
    expect(withProject.body.memories[0]).toMatchObject({
      name: 'widget-fact',
      project: 'acme/widgets',
    })
  })

  it('GET /memories/all is session-only, no-store, and spans every scope and project of the caller newest first', async () => {
    const orphanProject = {
      ...NOTE,
      scope: 'project',
      project: 'no/catalog-row',
      name: 'orphan-fact',
    }
    const otherProject = { ...NOTE, scope: 'project', project: 'acme/widgets', name: 'widget-fact' }
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)
    await http().put('/v1/memories/entry').set(as('session-a')).send(orphanProject).expect(200)
    await http().put('/v1/memories/entry').set(as('session-a')).send(otherProject).expect(200)
    await http()
      .put('/v1/memories/entry')
      .set(as('session-b'))
      .send({ ...NOTE, name: 'b-private' })
      .expect(200)

    const listed = await http().get('/v1/memories/all').set(as('session-a')).expect(200)

    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.body.memories.map((memory: { name: string }) => memory.name)).toEqual([
      'widget-fact',
      'orphan-fact',
      NOTE.name,
    ])
    expect(listed.body.memories[1]).toMatchObject({ scope: 'project', project: 'no/catalog-row' })
    const other = await http().get('/v1/memories/all').set(as('session-b')).expect(200)
    expect(other.body.memories.map((memory: { name: string }) => memory.name)).toEqual([
      'b-private',
    ])
  })

  it('GET /memories/all refuses pod and sandbox tokens and anonymous callers', async () => {
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)

    await http().get('/v1/memories/all').set(as('pod-token-a')).expect(401)
    await http().get('/v1/memories/all').set(as('sandbox-token-a')).expect(401)
    await http().get('/v1/memories/all').expect(401)
  })

  it('rejects invalid names and scope/project mismatches with 400', async () => {
    await http()
      .put('/v1/memories/entry')
      .set(as('session-a'))
      .send({ ...NOTE, name: 'Bad Name' })
      .expect(400)
    await http()
      .put('/v1/memories/entry')
      .set(as('session-a'))
      .send({ ...NOTE, scope: 'project' })
      .expect(400)
    await http()
      .put('/v1/memories/entry')
      .set(as('session-a'))
      .send({ ...NOTE, project: 'acme/widgets' })
      .expect(400)
    await http()
      .put('/v1/memories/entry')
      .set(as('session-a'))
      .send({ ...NOTE, scope: 'project', project: null })
      .expect(400)
    expect(fake.rows).toHaveLength(0)
  })

  it('delete answers 204 then 404', async () => {
    await http().put('/v1/memories/entry').set(as('session-a')).send(NOTE).expect(200)
    const remove = () =>
      http()
        .delete('/v1/memories/entry')
        .query({ scope: 'global', name: NOTE.name })
        .set(as('session-a'))

    await remove().expect(204)
    await remove().expect(404)
  })
})
