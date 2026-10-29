import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { NoticePort, toThreadId } from '@dltech/atlas-core'
import { newThreadMeta, sessionDirectory, threadMetaFile, writeMeta } from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'

import { composeBootApp } from '../serve-compose-boot'
import { wireWorkspaceSpecSchema, type WorkspaceSpec } from '../workspace-spec'

import { fakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcQueryUrl } from './trpc-fake'

const threadId = toThreadId('thread-model-boot')
const controlPlaneUrl = 'https://api.example.com'
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

class QuietNotice extends NoticePort {
  notify(): void {}
}

const wireThread = (model?: { ref: string; effort: string }) => ({
  id: threadId,
  head: 0,
  createdAt: '2026-10-23T00:00:00.000Z',
  updatedAt: '2026-10-23T00:00:00.000Z',
  workspace: null,
  repo: null,
  ...(model === undefined ? {} : { model }),
})

const composedModel = async (args: {
  env: Record<string, string | undefined>
  reply: () => Response
  stored?: { ref: string; effort: string }
  explicit?: { ref: string; effort?: string }
  spec?: WorkspaceSpec
}) => {
  const atlasHome = mkdtempSync(join(tmpdir(), 'atlas-serve-model-boot-'))
  homes.push(atlasHome)
  if (args.stored !== undefined) {
    await writeMeta({
      file: threadMetaFile({
        sessionDir: sessionDirectory({ home: atlasHome, sessionId: threadId }),
        threadId,
      }),
      meta: {
        ...newThreadMeta({ id: threadId, at: '2026-10-23T00:00:00.000Z' }),
        modelRef: args.stored.ref,
        modelEffort: args.stored.effort,
      },
    })
  }
  const reads: string[] = []
  let composedWith: { ref: string; effort?: string | undefined } | undefined
  await composeBootApp({
    compose: async (composeArgs) => {
      composedWith = composeArgs.model
      return fakeServeApp({ threadId, root: '/workspace' })
    },
    model: args.explicit,
    spec: args.spec ?? null,
    identity: null,
    threadId,
    cwd: '/workspace',
    atlasHome,
    controlPlaneUrl,
    token: 'serve-token',
    clientVersion: 'dev',
    env: args.env,
    notice: new QuietNotice(),
    fetchFn: (async (input: string | URL | Request) => {
      reads.push(String(input))
      return args.reply()
    }) as unknown as typeof fetch,
  })
  return { composedWith, reads }
}

const API_ENV = { [API_PROVISIONED_ENV]: '1' }

describe('composeBootApp thread model', () => {
  it('prefers the thread model stored in the API over stale local meta, effort included', async () => {
    const run = await composedModel({
      env: API_ENV,
      stored: { ref: 'a/old', effort: 'low' },
      reply: () => trpcOk(wireThread({ ref: 'b/new', effort: 'high' })),
    })
    expect(run.composedWith).toEqual({ ref: 'b/new', effort: 'high' })
    expect(run.reads).toEqual([
      trpcQueryUrl({ controlPlaneUrl, procedure: 'threads.get', input: { threadId } }),
    ])
  })

  it('falls back to the local meta when the API read fails', async () => {
    const run = await composedModel({
      env: API_ENV,
      stored: { ref: 'a/old', effort: 'low' },
      reply: () => trpcFailure({ status: 500, message: 'down' }),
    })
    expect(run.composedWith).toEqual({ ref: 'a/old', effort: 'low' })
  })

  it('falls back to the local meta when the API thread has no model', async () => {
    const run = await composedModel({
      env: API_ENV,
      stored: { ref: 'a/old', effort: 'low' },
      reply: () => trpcOk(wireThread()),
    })
    expect(run.composedWith).toEqual({ ref: 'a/old', effort: 'low' })
  })

  it('does not read the API for a sandbox it did not provision', async () => {
    const run = await composedModel({
      env: {},
      stored: { ref: 'a/old', effort: 'low' },
      reply: () => trpcOk(wireThread({ ref: 'b/new', effort: 'high' })),
    })
    expect(run.composedWith).toEqual({ ref: 'a/old', effort: 'low' })
    expect(run.reads).toEqual([])
  })

  it('keeps an explicit launch model over the API', async () => {
    const run = await composedModel({
      env: API_ENV,
      explicit: { ref: 'c/explicit' },
      reply: () => trpcOk(wireThread({ ref: 'b/new', effort: 'high' })),
    })
    expect(run.composedWith).toEqual({ ref: 'c/explicit' })
  })

  it('takes effort from the workspace spec when nothing else names a model', async () => {
    const run = await composedModel({
      env: {},
      spec: { remoteUrl: null, githubToken: null, model: 'a/spec', effort: 'low' },
      reply: () => trpcOk(wireThread()),
    })
    expect(run.composedWith).toEqual({ ref: 'a/spec', effort: 'low' })
  })

  it('keeps a spec model without effort as ref-only', async () => {
    const run = await composedModel({
      env: {},
      spec: { remoteUrl: null, githubToken: null, model: 'a/spec' },
      reply: () => trpcOk(wireThread()),
    })
    expect(run.composedWith).toEqual({ ref: 'a/spec' })
  })
})

describe('wireWorkspaceSpecSchema', () => {
  it('keeps the birth effort a local pod writes into the spec', () => {
    const parsed = wireWorkspaceSpecSchema.parse(
      JSON.parse(
        JSON.stringify({ remoteUrl: null, githubToken: null, model: 'a/spec', effort: 'high' }),
      ),
    )
    expect(parsed).toMatchObject({ model: 'a/spec', effort: 'high' })
  })
})
