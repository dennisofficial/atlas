import { describe, expect, it } from 'bun:test'

import { artifactSpecSchema } from '@dltech/atlas-artifacts'
import type { ArtifactSummary, ArtifactUpload } from '@dltech/atlas-wire'

import { trpcCallOf, trpcData, trpcFailure, trpcVoid } from '../../cloud/__tests__/trpc-wire'
import type { CloudSession } from '../../cloud/cloud-session'
import { ArtifactRefused, ArtifactUnavailable } from '../artifact-port'
import { CloudArtifactPort } from '../cloud-artifact-port'

const SESSION: CloudSession = { url: 'https://cloud.test', token: 'tok-1', email: null }

type Call = {
  url: string
  method: string
  procedure: string
  authorization: string | null
  input: unknown
  signalled: boolean
}

const BEGINNED = {
  artifactId: 'art_1',
  token: 'artifact-token',
  slug: 'demo',
  version: 3,
  uploads: [
    {
      path: 'index.html',
      tree: 'src',
      sha256: 'a'.repeat(64),
      url: 'https://upload.test/index.html',
    },
  ] satisfies ArtifactUpload[],
}

const SUMMARY: ArtifactSummary = {
  slug: 'demo',
  name: 'Demo',
  url: 'https://demo.artifacts.test',
  currentVersion: 3,
  status: 'ready',
  bytes: 2048,
  fileCount: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  sourceHash: null,
  specHash: null,
}

const portWith = (args: { respond: (call: Call) => Response; session?: CloudSession | null }) => {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const traced = trpcCallOf({ input, init })
    const call: Call = {
      url: String(input),
      method: traced.method,
      procedure: traced.procedure,
      authorization: headers.get('authorization'),
      input: traced.input,
      signalled: init?.signal !== null && init?.signal !== undefined,
    }
    calls.push(call)
    return args.respond(call)
  }) as typeof fetch
  const port = new CloudArtifactPort({
    session: () => (args.session === undefined ? SESSION : args.session),
    clientVersion: '1.0.0',
    fetchFn,
  })
  return { port, calls }
}

const failure = (args: { status: number; trpcCode: string; message?: string }): Response =>
  trpcFailure({
    status: args.status,
    message: args.message ?? 'refused',
    trpcCode: args.trpcCode,
  })

const entry = {
  path: 'index.html',
  tree: 'src' as const,
  sha256: 'a'.repeat(64),
  size: 12,
  type: 'text/html',
}

const failureOf = async (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    () => null,
    (error: unknown) => error,
  )

describe('CloudArtifactPort', () => {
  it('begins a publish with the bearer token and answers without the upload token', async () => {
    const { port, calls } = portWith({ respond: () => trpcData(BEGINNED) })

    const begun = await port.beginPublish({ slug: 'demo', name: 'Demo', entries: [entry] })

    expect(calls[0]?.procedure).toBe('artifacts.beginPublish')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.authorization).toBe('Bearer tok-1')
    expect(calls[0]?.input).toEqual({ slug: 'demo', name: 'Demo', entries: [entry] })
    expect(begun).toEqual({
      artifactId: 'art_1',
      slug: 'demo',
      version: 3,
      uploads: BEGINNED.uploads,
    })
    expect(Object.keys(begun)).not.toContain('token')
  })

  it('omits a slug and a name it was not given', async () => {
    const { port, calls } = portWith({ respond: () => trpcData(BEGINNED) })

    await port.beginPublish({ entries: [entry] })

    expect(calls[0]?.input).toEqual({ entries: [entry] })
  })

  it('makes one bounded attempt at a begin, so a wedged control plane cannot stall a publish', async () => {
    const { port, calls } = portWith({ respond: () => failure({ status: 503, trpcCode: 'X' }) })

    const error = await failureOf(port.beginPublish({ entries: [entry] }))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.signalled).toBe(true)
    expect(error).toBeInstanceOf(ArtifactUnavailable)
  })

  it('commits the version with the spec it was planned with', async () => {
    const { port, calls } = portWith({
      respond: () =>
        trpcData({
          slug: 'demo',
          version: 3,
          url: 'https://demo.artifacts.test',
          status: 'building',
        }),
    })

    const spec = artifactSpecSchema.parse({})

    const committed = await port.commitPublish({ artifactId: 'art_1', version: 3, spec })

    expect(calls[0]?.procedure).toBe('artifacts.commitPublish')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.input).toEqual({ artifactId: 'art_1', version: 3, spec })
    expect(committed).toEqual({
      slug: 'demo',
      version: 3,
      url: 'https://demo.artifacts.test',
      status: 'building',
    })
  })

  it('lists artifacts from artifacts.list', async () => {
    const { port, calls } = portWith({ respond: () => trpcData({ artifacts: [SUMMARY] }) })

    expect(await port.list()).toEqual([SUMMARY])
    expect(calls[0]?.procedure).toBe('artifacts.list')
    expect(calls[0]?.method).toBe('GET')
  })

  it('passes the signed source URLs through unchanged', async () => {
    const entries = [
      { path: 'src/main.ts', url: 'https://signed.test/src/main.ts?sig=abc' },
      { path: 'package.json', url: 'https://signed.test/package.json?sig=def' },
    ]
    const { port, calls } = portWith({ respond: () => trpcData({ entries }) })

    const exported = await port.sourceExport({ slug: 'demo' })

    expect(calls[0]?.procedure).toBe('artifacts.sourceExport')
    expect(calls[0]?.input).toEqual({ slug: 'demo' })
    expect(exported.entries).toEqual(entries)
  })

  it('unpublishes by slug', async () => {
    const { port, calls } = portWith({ respond: () => trpcData({ ok: true }) })

    await port.unpublish({ slug: 'demo' })

    expect(calls[0]?.procedure).toBe('artifacts.unpublish')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.input).toEqual({ slug: 'demo' })
  })

  it('accepts a void answer to an unpublish', async () => {
    const { port } = portWith({ respond: () => trpcVoid() })

    await port.unpublish({ slug: 'demo' })
  })

  it.each([
    { procedure: 'begin', status: 400, trpcCode: 'BAD_REQUEST' },
    { procedure: 'begin', status: 422, trpcCode: 'UNPROCESSABLE_CONTENT' },
    { procedure: 'begin', status: 404, trpcCode: 'NOT_FOUND' },
    { procedure: 'begin', status: 409, trpcCode: 'CONFLICT' },
  ])('maps a $status $trpcCode on $procedure to ArtifactRefused', async (refused) => {
    const { port } = portWith({
      respond: () => failure({ ...refused, message: `no published content for src/a.ts` }),
    })

    const error = await failureOf(port.beginPublish({ entries: [entry] }))

    expect(error).toBeInstanceOf(ArtifactRefused)
    expect((error as Error).message).toContain('no published content for src/a.ts')
  })

  it('maps a 404 on a pull to ArtifactRefused', async () => {
    const { port } = portWith({ respond: () => failure({ status: 404, trpcCode: 'NOT_FOUND' }) })

    expect(await failureOf(port.sourceExport({ slug: 'gone' }))).toBeInstanceOf(ArtifactRefused)
  })

  it.each([
    { status: 500, trpcCode: 'INTERNAL_SERVER_ERROR' },
    { status: 503, trpcCode: 'SERVICE_UNAVAILABLE' },
    { status: 401, trpcCode: 'UNAUTHORIZED' },
    { status: 403, trpcCode: 'FORBIDDEN' },
  ])('maps a $status on unpublish to ArtifactUnavailable', async (outage) => {
    const { port } = portWith({ respond: () => failure(outage) })

    expect(await failureOf(port.unpublish({ slug: 'demo' }))).toBeInstanceOf(ArtifactUnavailable)
  })

  it('maps an unreachable control plane to ArtifactUnavailable', async () => {
    const { port } = portWith({
      respond: () => {
        throw new TypeError('connection refused')
      },
    })

    const error = await failureOf(port.unpublish({ slug: 'demo' }))

    expect(error).toBeInstanceOf(ArtifactUnavailable)
    expect((error as Error).message).toContain('could not be reached')
  })

  it('tells the model to sign in when the session was refused', async () => {
    const { port } = portWith({ respond: () => failure({ status: 401, trpcCode: 'UNAUTHORIZED' }) })

    const error = await failureOf(port.unpublish({ slug: 'demo' }))

    expect((error as Error).message).toContain('sign in again')
  })

  it.each([
    { method: 'list', run: (port: CloudArtifactPort) => port.list() },
    {
      method: 'beginPublish',
      run: (port: CloudArtifactPort) => port.beginPublish({ entries: [entry] }),
    },
    {
      method: 'commitPublish',
      run: (port: CloudArtifactPort) =>
        port.commitPublish({ artifactId: 'art_1', version: 3, spec: artifactSpecSchema.parse({}) }),
    },
    {
      method: 'sourceExport',
      run: (port: CloudArtifactPort) => port.sourceExport({ slug: 'demo' }),
    },
    { method: 'unpublish', run: (port: CloudArtifactPort) => port.unpublish({ slug: 'demo' }) },
  ])('refuses $method before any request when signed out', async (invoke) => {
    const { port, calls } = portWith({ respond: () => trpcData({}), session: null })

    const error = await failureOf(invoke.run(port))

    expect(error).toBeInstanceOf(ArtifactUnavailable)
    expect((error as Error).message).toContain('Atlas Cloud')
    expect(calls).toHaveLength(0)
  })

  it('names the procedure when an answer is not an artifact', async () => {
    const { port } = portWith({ respond: () => trpcData({ nope: true }) })

    const error = await failureOf(port.list())

    expect(error).toBeInstanceOf(ArtifactUnavailable)
    expect((error as Error).message).toContain('artifacts.list')
  })
})
