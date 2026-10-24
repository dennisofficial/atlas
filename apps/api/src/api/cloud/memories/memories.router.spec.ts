import {
  MEMORY_EDIT_AMBIGUOUS_CODE,
  MEMORY_EDIT_NO_MATCH_CODE,
  MEMORY_STALE_REVISION_CODE,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import { createPersonalApp, trpcMutate, trpcQuery } from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../web-settings.fake-db'
import { MemoriesRouter } from './memories.router'
import { MemoriesService } from './memories.service'

@Router({ alias: 'probe' })
class ProbeRouter {
  @Query({ output: z.object({ ok: z.literal(true) }) })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  plain(): { ok: true } {
    return { ok: true }
  }

  @Query({ output: z.object({ ok: z.literal(true) }) })
  @UseMiddlewares(SessionMiddleware)
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

const KEY = { scope: 'global', name: NOTE.name }

describe('MemoriesRouter', () => {
  useTestDatabase()
  let app: INestApplication

  const query = (procedure: string, token?: string, input?: object) =>
    trpcQuery({ app, procedure, token, input })
  const mutate = (procedure: string, token?: string, input?: object) =>
    trpcMutate({ app, procedure, token, input })
  const put = (token: string, note: object = NOTE) => mutate('memories.put', token, note)
  const entry = (token: string) => query('memories.get', token, KEY)
  const namesOf = (reply: { body: { result: { data: { memories: { name: string }[] } } } }) =>
    reply.body.result.data.memories.map((memory) => memory.name)

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp([MemoriesRouter, MemoriesService, ProbeRouter])
  })

  afterEach(() => app.close())

  it("a session writes and the same user's pod lease token reads it", async () => {
    const written = await put('session-a').expect(200)
    expect(written.body.result.data).toMatchObject({
      name: NOTE.name,
      scope: 'global',
      project: null,
      revision: 1,
    })

    const read = await entry('pod-token-a').expect(200)

    expect(read.headers['cache-control']).toBe('no-store')
    expect(read.body.result.data).toMatchObject({ name: NOTE.name, body: NOTE.body, revision: 1 })
  })

  it('a stale-revision edit is a 409 CONFLICT with the memory-stale-revision code', async () => {
    await put('session-a').expect(200)
    await put('session-a', { ...NOTE, body: 'Raw deflate v2' }).expect(200)

    const stale = await mutate('memories.edit', 'session-a', {
      ...KEY,
      old: 'v2',
      new: 'v3',
      revision: 1,
    }).expect(409)

    expect(stale.body.error.data).toMatchObject({ code: 'CONFLICT', httpStatus: 409 })
    expect(stale.body.error.data.details.code).toBe(MEMORY_STALE_REVISION_CODE)
    expect(stale.body.error.data.details.message).toContain('revision 2')
  })

  it('an edit whose text is missing or repeated is a 422 UNPROCESSABLE_CONTENT with its code', async () => {
    await put('session-a', { ...NOTE, body: 'twice twice' }).expect(200)
    const edit = (old: string) =>
      mutate('memories.edit', 'session-a', { ...KEY, old, new: 'once', revision: 1 }).expect(422)

    const missing = await edit('absent')
    const repeated = await edit('twice')

    for (const [reply, code] of [
      [missing, MEMORY_EDIT_NO_MATCH_CODE],
      [repeated, MEMORY_EDIT_AMBIGUOUS_CODE],
    ] as const) {
      expect(reply.body.error.data).toMatchObject({
        code: 'UNPROCESSABLE_CONTENT',
        httpStatus: 422,
      })
      expect(reply.body.error.data.details.code).toBe(code)
    }
  })

  it('an edit at the current revision applies and returns the next revision', async () => {
    await put('session-a').expect(200)

    const edited = await mutate('memories.edit', 'pod-token-a', {
      ...KEY,
      old: 'observed',
      new: 'measured',
      revision: 1,
    }).expect(200)

    expect(edited.body.result.data.revision).toBe(2)
    expect((await entry('session-a').expect(200)).body.result.data.body).toContain('measured')
  })

  it("another user's session gets 404 for the memory and cannot delete it", async () => {
    await put('session-a').expect(200)

    await entry('session-b').expect(404)
    await mutate('memories.remove', 'session-b', KEY).expect(404)
    await entry('session-a').expect(200)
  })

  it('a pod bearer is refused on a non-memory session-or-sandbox procedure and unauthorized on a session-only one', async () => {
    await query('probe.plain', 'pod-token-a').expect(403)
    await query('probe.sessionOnly', 'pod-token-a').expect(401)
    await query('probe.sessionOnly', 'session-a').expect(200)
  })

  it('a sandbox principal can list its owner’s memories', async () => {
    await put('session-a').expect(200)

    const listed = await query('memories.list', 'sandbox-token-a', {}).expect(200)

    expect(namesOf(listed)).toEqual([NOTE.name])
  })

  it('lists project memories only when the project is named, lowercased', async () => {
    const projectNote = { ...NOTE, scope: 'project', project: 'acme/widgets', name: 'widget-fact' }
    await put('session-a', projectNote).expect(200)

    const without = await query('memories.list', 'pod-token-a', {}).expect(200)
    const withProject = await query('memories.list', 'pod-token-a', {
      project: 'Acme/Widgets',
    }).expect(200)

    expect(without.body.result.data.memories).toEqual([])
    expect(withProject.body.result.data.memories[0]).toMatchObject({
      name: 'widget-fact',
      project: 'acme/widgets',
    })
  })

  it('listAll is session-only, no-store, and spans every scope and project of the caller newest first', async () => {
    const orphanProject = {
      ...NOTE,
      scope: 'project',
      project: 'no/catalog-row',
      name: 'orphan-fact',
    }
    const otherProject = { ...NOTE, scope: 'project', project: 'acme/widgets', name: 'widget-fact' }
    await put('session-a').expect(200)
    await put('session-a', orphanProject).expect(200)
    await put('session-a', otherProject).expect(200)
    await put('session-b', { ...NOTE, name: 'b-private' }).expect(200)

    const listed = await query('memories.listAll', 'session-a').expect(200)

    expect(listed.headers['cache-control']).toBe('no-store')
    expect(namesOf(listed)).toEqual(['widget-fact', 'orphan-fact', NOTE.name])
    expect(listed.body.result.data.memories[1]).toMatchObject({
      scope: 'project',
      project: 'no/catalog-row',
    })
    expect(namesOf(await query('memories.listAll', 'session-b').expect(200))).toEqual(['b-private'])
  })

  it('listAll refuses pod and sandbox tokens and anonymous callers', async () => {
    await put('session-a').expect(200)

    await query('memories.listAll', 'pod-token-a').expect(401)
    await query('memories.listAll', 'sandbox-token-a').expect(401)
    await query('memories.listAll').expect(401)
  })

  it('rejects invalid names, unknown keys and scope/project mismatches with 400', async () => {
    await put('session-a', { ...NOTE, name: 'Bad Name' }).expect(400)
    await put('session-a', { ...NOTE, scope: 'project' }).expect(400)
    await put('session-a', { ...NOTE, project: 'acme/widgets' }).expect(400)
    await put('session-a', { ...NOTE, scope: 'project', project: null }).expect(400)
    await put('session-a', { ...NOTE, bogus: true }).expect(400)
    expect(await db.orm.public.Memory.where((row) => row.id.neq('')).all()).toHaveLength(0)
  })

  it('remove answers 200 then 404', async () => {
    await put('session-a').expect(200)
    const remove = () => mutate('memories.remove', 'session-a', KEY)

    expect((await remove().expect(200)).body).toEqual({ result: {} })
    await remove().expect(404)
  })
})
