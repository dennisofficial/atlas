import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../web-settings.fake-db'
import { buildProjectsApp, createProjectAs } from './projects.router.fixture'

const CONTENTS = 'TOKEN=super-secret\n'

describe('project file mounts router', () => {
  useTestDatabase()
  let app: INestApplication

  const mutate = (args: { path: string; token?: string; input: object }) =>
    trpcMutation({
      app,
      path: `projectResources.${args.path}`,
      token: args.token ?? 'session-a',
      input: args.input,
    })
  const query = (args: { path: string; token?: string; input: object }) =>
    trpcQuery({
      app,
      path: `projectResources.${args.path}`,
      token: args.token ?? 'session-a',
      input: args.input,
    })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildProjectsApp({ githubTokens: { 'user-a': 'gho_a' } })
  })

  afterEach(async () => {
    unstubAllGlobals()
    await app.close()
  })

  it('round trips a mount, hides contents in the list and stores them sealed', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await mutate({
      path: 'setFileMount',
      input: { projectId, path: 'b/.env', contents: CONTENTS },
    }).expect(200)
    await mutate({
      path: 'setFileMount',
      input: { projectId, path: '~/a.pem', contents: 'pem', mode: 0o644 },
    }).expect(200)

    const listed = await query({ path: 'listFileMounts', input: { projectId } }).expect(200)
    expect(listed.text).not.toContain('super-secret')
    const mounts = (dataOf(listed.body) as { mounts: { path: string; mode: number }[] }).mounts
    expect(mounts.map((mount) => mount.path)).toEqual(['b/.env', '~/a.pem'])
    expect(mounts.map((mount) => mount.mode)).toEqual([384, 0o644])
    expect(Object.keys(mounts[0] ?? {}).sort()).toEqual(['createdAt', 'mode', 'path', 'updatedAt'])

    const revealed = await query({
      path: 'revealFileMount',
      input: { projectId, path: 'b/.env' },
    }).expect(200)
    expect(dataOf(revealed.body)).toEqual({ contents: CONTENTS })
    const rows = await db.orm.public.ProjectFileMount.where((row) => row.id.neq('')).all()
    for (const row of rows) expect(row.sealedContents).not.toContain('super-secret')

    await mutate({
      path: 'setFileMount',
      input: { projectId, path: 'b/.env', contents: 'new', mode: 0o640 },
    }).expect(200)
    const updated = await query({ path: 'listFileMounts', input: { projectId } }).expect(200)
    expect(dataOf(updated.body)).toMatchObject({
      mounts: [{ path: 'b/.env', mode: 0o640 }, { path: '~/a.pem' }],
    })

    await mutate({ path: 'removeFileMount', input: { projectId, path: 'b/.env' } }).expect(200)
    await mutate({ path: 'removeFileMount', input: { projectId, path: 'b/.env' } }).expect(200)
    await query({ path: 'revealFileMount', input: { projectId, path: 'b/.env' } }).expect(404)
  })

  it('requires a fresh session to reveal', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await mutate({
      path: 'setFileMount',
      input: { projectId, path: 'x.txt', contents: CONTENTS },
    }).expect(200)
    const stale = await query({
      path: 'revealFileMount',
      token: 'stale:session-a',
      input: { projectId, path: 'x.txt' },
    }).expect(403)
    expect(stale.text).toContain('REAUTH_REQUIRED')
    expect(stale.text).not.toContain('super-secret')
  })

  it('rejects invalid paths, oversized contents and bad modes', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    for (const path of ['../x', '/abs', '.git/config', '', '   ']) {
      await mutate({ path: 'setFileMount', input: { projectId, path, contents: 'x' } }).expect(400)
    }
    await mutate({
      path: 'setFileMount',
      input: { projectId, path: 'big.txt', contents: 'x'.repeat(64 * 1024 + 1) },
    }).expect(400)
    await mutate({
      path: 'setFileMount',
      input: { projectId, path: 'ok.txt', contents: 'x'.repeat(64 * 1024) },
    }).expect(200)
    await mutate({
      path: 'setFileMount',
      input: { projectId, path: 'm.txt', contents: 'x', mode: 0o1000 },
    }).expect(400)
  })

  it('answers 404 for a project that is not the caller’s', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    const token = 'session-b'
    await query({ path: 'listFileMounts', token, input: { projectId } }).expect(404)
    await query({ path: 'revealFileMount', token, input: { projectId, path: 'a' } }).expect(404)
    await mutate({
      path: 'setFileMount',
      token,
      input: { projectId, path: 'a', contents: 'v' },
    }).expect(404)
    await mutate({ path: 'removeFileMount', token, input: { projectId, path: 'a' } }).expect(404)
    await query({ path: 'repoTree', token, input: { projectId } }).expect(404)
    expect(await db.orm.public.ProjectFileMount.where((row) => row.id.neq('')).all()).toHaveLength(
      0,
    )
  })

  it('maps the github tree to files and folders, skipping submodules', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          truncated: true,
          tree: [
            { path: 'src', type: 'tree' },
            { path: 'src/a.ts', type: 'blob' },
            { path: 'vendor/lib', type: 'commit' },
          ],
        }),
      ),
    )
    stubGlobal('fetch', fetchStub)
    const response = await query({ path: 'repoTree', input: { projectId } }).expect(200)
    expect(dataOf(response.body)).toEqual({
      entries: [
        { path: 'src', kind: 'folder' },
        { path: 'src/a.ts', kind: 'file' },
      ],
      truncated: true,
    })
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/dennisofficial/atlas/git/trees/main?recursive=1')
    expect(init.headers).toMatchObject({ authorization: 'Bearer gho_a' })
  })

  it('returns an empty tree without a repo or a github token and maps failures', async () => {
    const noRepo = await createProjectAs({
      app,
      token: 'session-a',
      body: { name: 'bare', repo: null, baseBranch: null, additionalRepos: [] },
    })
    expect(
      dataOf((await query({ path: 'repoTree', input: { projectId: noRepo } }).expect(200)).body),
    ).toEqual({
      entries: [],
      truncated: false,
    })
    const projectId = await createProjectAs({ app, token: 'session-a' })
    stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    await query({ path: 'repoTree', input: { projectId } }).expect(404)
    stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    await query({ path: 'repoTree', input: { projectId } }).expect(502)
  })
})
