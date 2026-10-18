import { describe, expect, it } from 'bun:test'

import { APIError } from '@vercel/sandbox'

import { EVercelFailure, VercelFailure } from '@dltech/atlas-wire'
import { VercelDriver } from '../vercel-driver'
import {
  CREDENTIALS,
  PINNED_VERSION,
  fakeSandbox,
  notFound,
  imageNotReady,
  type FakeSandbox,
} from './vercel-driver-fixture'

describe('createOrResume', () => {
  it('waits out the image optimization lag and boots once the image is ready', async () => {
    let calls = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      settleRetry: { attempts: 10, delayMs: 0 },
      imageOptimizeRetry: { attempts: 5, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          calls += 1
          if (calls < 3) throw imageNotReady('Image is not ready.')
          const fresh = fakeSandbox()
          await params?.onCreate?.(fresh)
          return fresh
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(calls).toBe(3)
    expect(placement.created).toBe(true)
  })

  it('fails a poisoned image without retrying, naming the republish as the recovery', async () => {
    let calls = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      settleRetry: { attempts: 10, delayMs: 0 },
      imageOptimizeRetry: { attempts: 5, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          calls += 1
          throw imageNotReady('Image optimization failed.')
        },
      },
    })

    const failure = await driver
      .createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })
      .catch((caught: unknown) => caught)

    expect(failure).toBeInstanceOf(VercelFailure)
    expect((failure as VercelFailure).kind).toBe(EVercelFailure.ImageOptimize)
    expect((failure as Error).message).toContain('fresh digest')
    expect(calls).toBe(1)
  })

  it('fails fast on an unpublished image, naming the publish as the recovery', async () => {
    let calls = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      settleRetry: { attempts: 10, delayMs: 0 },
      imageOptimizeRetry: { attempts: 5, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          calls += 1
          throw new APIError(new Response(null, { status: 404 }), {
            json: { error: { message: 'Image not found.' } },
          })
        },
      },
    })

    const failure = await driver
      .createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })
      .catch((caught: unknown) => caught)

    expect(calls).toBe(1)
    expect(failure).toBeInstanceOf(VercelFailure)
    expect((failure as VercelFailure).kind).toBe(EVercelFailure.ImageNotFound)
    expect((failure as Error).message).toContain(`atlas-sandbox:${PINNED_VERSION}`)
  })

  it('rolls back the sandbox a failed wake created', async () => {
    let freshBoot: FakeSandbox | undefined
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      settleRetry: { attempts: 10, delayMs: 0 },
      imageOptimizeRetry: { attempts: 5, delayMs: 0 },
      sdk: {
        get: async () => {
          if (freshBoot !== undefined) return freshBoot
          throw notFound()
        },
        getOrCreate: async (params) => {
          freshBoot = fakeSandbox()
          await params?.onCreate?.(freshBoot)
          return freshBoot
        },
      },
    })

    await expect(
      driver.createOrResume({
        name: 'atlas-thread-x',
        threadId: 'brn_cloud',
        token: 't',
        putContextOnFreshBoot: async () => {
          throw new Error('write failed')
        },
      }),
    ).rejects.toThrow('write failed')

    expect(freshBoot?.deleted).toBe(true)
  })

  it('keeps a pre-existing sandbox when the failed wake rolls back', async () => {
    const existing = fakeSandbox({ installedVersion: PINNED_VERSION })
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      settleRetry: { attempts: 10, delayMs: 0 },
      imageOptimizeRetry: { attempts: 5, delayMs: 0 },
      sdk: {
        get: async () => existing,
        getOrCreate: async (params) => {
          await params?.onResume?.(existing)
          return existing
        },
      },
    })

    await expect(
      driver.createOrResume({
        name: 'atlas-thread-x',
        threadId: 'brn_cloud',
        token: 't',
        putContextOnFreshBoot: async () => {
          throw new Error('write failed')
        },
      }),
    ).rejects.toThrow('write failed')

    expect(existing.deleted).toBe(false)
  })
})
