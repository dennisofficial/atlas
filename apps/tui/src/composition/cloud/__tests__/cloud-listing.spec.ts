import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { SessionsClient, type ThreadSummary } from '@dltech/atlas-harness'

import { fakeApp, fakeCloud, fakeSignedOutCloud, failingModelPort } from '../../__tests__/fake-app'

const unusedModel = () => failingModelPort({ message: 'listing must not invoke a model' })
import { cloudListing } from '../cloud-listing'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function cloudWithResponse(response: Promise<Response>) {
  return fakeCloud({
    sessionsClientFor: () => new SessionsClient({
      url: 'https://cloud.test',
      token: 'fake',
      fetchFn: Object.assign(async () => response, { preconnect: fetch.preconnect }),
    }),
  })
}

describe('progressive local and cloud listing', () => {
  it('publishes local rows before a slow cloud request finishes', async () => {
    const response = deferred<Response>()
    const app = fakeApp({ model: unusedModel(), cloud: cloudWithResponse(response.promise) })
    const thread = await app.threads.create({ workspace: app.config.cwd, title: 'local' })
    const published = deferred<readonly ThreadSummary[]>()
    let finished = false
    const listing = cloudListing(app).list({
      project: app.config.cwd,
      onUpdate: (rows) => {
        if (rows.some((row) => row.id === thread.id)) published.resolve(rows)
      },
    }).then((rows) => { finished = true; return rows })

    expect((await published.promise).map((row) => row.title)).toContain('local')
    expect(finished).toBe(false)
    response.resolve(Response.json([]))
    expect((await listing).map((row) => row.id)).toContain(thread.id)
  })

  it('starts the remote request while local listing is pending', async () => {
    const requested = deferred<void>()
    const localReady = deferred<readonly ThreadSummary[]>()
    const app = fakeApp({
      model: unusedModel(),
      cloud: fakeCloud({
        sessionsClientFor: () => new SessionsClient({
          url: 'https://cloud.test', token: 'fake',
          fetchFn: Object.assign(async () => { requested.resolve(); return Response.json([]) }, { preconnect: fetch.preconnect }),
        }),
      }),
    })
    app.threads.list = async () => localReady.promise
    const listing = cloudListing(app).list({ project: app.config.cwd })
    await requested.promise
    localReady.resolve([])
    expect(await listing).toEqual([])
  })

  it('does not publish an empty state before local discovery finishes', async () => {
    const localReady = deferred<readonly ThreadSummary[]>()
    const app = fakeApp({ model: unusedModel(), cloud: cloudWithResponse(Promise.resolve(Response.json([]))) })
    app.threads.list = async () => localReady.promise
    const emissions: (readonly ThreadSummary[])[] = []
    const listing = cloudListing(app).list({ project: app.config.cwd, onUpdate: (rows) => emissions.push(rows) })
    await Promise.resolve()
    await Promise.resolve()
    expect(emissions).toHaveLength(0)
    localReady.resolve([])
    expect(await listing).toEqual([])
    expect(emissions.length).toBeGreaterThan(0)
  })

  it('keeps local rows on remote failure and honors the local limit', async () => {
    const app = fakeApp({ model: unusedModel(), cloud: cloudWithResponse(Promise.resolve(new Response('', { status: 503 }))) })
    await app.threads.create({ workspace: app.config.cwd, title: 'first' })
    await app.threads.create({ workspace: app.config.cwd, title: 'second' })
    expect(await cloudListing(app).list({ project: app.config.cwd, limit: 1 })).toHaveLength(1)
  })

  it('keeps the local placement for a duplicate cloud thread', async () => {
    const response = deferred<Response>()
    const app = fakeApp({ model: unusedModel(), cloud: cloudWithResponse(response.promise) })
    const local = await app.threads.create({ workspace: app.config.cwd, title: 'local wins' })
    response.resolve(Response.json([{ ...local, title: 'remote', executionLocation: EExecutionLocation.Cloud }]))
    const rows = await cloudListing(app).list({ project: app.config.cwd })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('local wins')
  })

  it('enriches selected local rows without querying the cloud again', async () => {
    const response = deferred<Response>()
    const app = fakeApp({ model: unusedModel(), cloud: cloudWithResponse(response.promise) })
    const local = await app.threads.create({ workspace: app.config.cwd, title: 'selected' })
    const rows = await cloudListing(app).list({ project: app.config.cwd, enrich: [local.id] })
    expect(rows[0]?.id).toBe(local.id)
  })

  it('does not need cloud access when signed out', async () => {
    const app = fakeApp({ model: unusedModel(), cloud: fakeSignedOutCloud() })
    const local = await app.threads.create({ workspace: app.config.cwd, title: 'offline' })
    const rows = await cloudListing(app).list({ project: app.config.cwd })
    expect(rows[0]?.id).toBe(local.id)
  })
})
