import { describe, expect, it } from 'bun:test'

import { trpcData, trpcVoid } from '../../cloud/__tests__/trpc-wire'
import { ArtifactNotFound, ArtifactRefused, ArtifactUnavailable } from '../artifact-port'
import { CloudArtifactPort } from '../cloud-artifact-port'
import { BEGINNED, SUMMARY, entry, failure, failureOf, portWith } from './cloud-artifact-port-rig'

describe('CloudArtifactPort', () => {
  it('begins a publish with the bearer token and answers without the upload token', async () => {
    const { port, calls } = portWith({ respond: () => trpcData(BEGINNED) })

    const begun = await port.beginPublish({ subdomain: 'demo', name: 'Demo', entries: [entry] })

    expect(calls[0]?.procedure).toBe('artifacts.beginPublish')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.authorization).toBe('Bearer tok-1')
    expect(calls[0]?.input).toEqual({ subdomain: 'demo', name: 'Demo', entries: [entry] })
    expect(begun).toEqual({
      artifactId: 'art_1',
      subdomain: 'demo',
      version: 3,
      uploads: BEGINNED.uploads,
    })
    expect(Object.keys(begun)).not.toContain('token')
  })

  it('omits a subdomain and a name it was not given', async () => {
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

  it('commits the version without a spec, so the server reads artifact.json from the source', async () => {
    const { port, calls } = portWith({
      respond: () =>
        trpcData({
          subdomain: 'demo',
          version: 3,
          url: 'https://demo.artifacts.test',
          status: 'building',
        }),
    })

    const committed = await port.commitPublish({ artifactId: 'art_1', version: 3 })

    expect(calls[0]?.procedure).toBe('artifacts.commitPublish')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.input).toEqual({ artifactId: 'art_1', version: 3 })
    expect(committed).toEqual({
      subdomain: 'demo',
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

    const exported = await port.sourceExport({ subdomain: 'demo' })

    expect(calls[0]?.procedure).toBe('artifacts.sourceExport')
    expect(calls[0]?.input).toEqual({ subdomain: 'demo' })
    expect(exported.entries).toEqual(entries)
  })

  it('unpublishes by subdomain', async () => {
    const { port, calls } = portWith({ respond: () => trpcData({ ok: true }) })

    await port.unpublish({ subdomain: 'demo' })

    expect(calls[0]?.procedure).toBe('artifacts.unpublish')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.input).toEqual({ subdomain: 'demo' })
  })

  it('accepts a void answer to an unpublish', async () => {
    const { port } = portWith({ respond: () => trpcVoid() })

    await port.unpublish({ subdomain: 'demo' })
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

  it('maps a 404 on a begin to ArtifactNotFound, so a vanished artifact is told apart', async () => {
    const { port } = portWith({
      respond: () => failure({ status: 404, trpcCode: 'NOT_FOUND', message: 'no artifact demo' }),
    })

    const error = await failureOf(port.beginPublish({ subdomain: 'demo', entries: [entry] }))

    expect(error).toBeInstanceOf(ArtifactNotFound)
    expect(error).toBeInstanceOf(ArtifactRefused)
  })

  it('keeps a 400 on a begin a plain refusal', async () => {
    const { port } = portWith({
      respond: () => failure({ status: 400, trpcCode: 'BAD_REQUEST', message: 'too big' }),
    })

    expect(await failureOf(port.beginPublish({ entries: [entry] }))).not.toBeInstanceOf(
      ArtifactNotFound,
    )
  })

  it('maps a 404 on a pull to ArtifactRefused', async () => {
    const { port } = portWith({ respond: () => failure({ status: 404, trpcCode: 'NOT_FOUND' }) })

    expect(await failureOf(port.sourceExport({ subdomain: 'gone' }))).toBeInstanceOf(
      ArtifactRefused,
    )
  })

  it.each([
    { status: 500, trpcCode: 'INTERNAL_SERVER_ERROR' },
    { status: 503, trpcCode: 'SERVICE_UNAVAILABLE' },
    { status: 401, trpcCode: 'UNAUTHORIZED' },
    { status: 403, trpcCode: 'FORBIDDEN' },
  ])('maps a $status on unpublish to ArtifactUnavailable', async (outage) => {
    const { port } = portWith({ respond: () => failure(outage) })

    expect(await failureOf(port.unpublish({ subdomain: 'demo' }))).toBeInstanceOf(
      ArtifactUnavailable,
    )
  })

  it('maps an unreachable control plane to ArtifactUnavailable', async () => {
    const { port } = portWith({
      respond: () => {
        throw new TypeError('connection refused')
      },
    })

    const error = await failureOf(port.unpublish({ subdomain: 'demo' }))

    expect(error).toBeInstanceOf(ArtifactUnavailable)
    expect((error as Error).message).toContain('could not be reached')
  })

  it('tells the model to sign in when the session was refused', async () => {
    const { port } = portWith({ respond: () => failure({ status: 401, trpcCode: 'UNAUTHORIZED' }) })

    const error = await failureOf(port.unpublish({ subdomain: 'demo' }))

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
      run: (port: CloudArtifactPort) => port.commitPublish({ artifactId: 'art_1', version: 3 }),
    },
    {
      method: 'buildStatus',
      run: (port: CloudArtifactPort) => port.buildStatus({ subdomain: 'demo', version: 3 }),
    },
    {
      method: 'sourceExport',
      run: (port: CloudArtifactPort) => port.sourceExport({ subdomain: 'demo' }),
    },
    {
      method: 'unpublish',
      run: (port: CloudArtifactPort) => port.unpublish({ subdomain: 'demo' }),
    },
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
