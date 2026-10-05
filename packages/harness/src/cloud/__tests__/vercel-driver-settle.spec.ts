import { describe, expect, it } from 'bun:test'

import { VercelDriver } from '../vercel-driver'
import { ESettleWait, type SettleWaitNotice } from '../vercel-driver-mount'
import { EVercelFailure, VercelFailure } from '../vercel-errors'
import { CREDENTIALS, PINNED_VERSION, alreadyAttachedError, fakeSandbox, fakeDriveSdk, nameTakenError, notFound } from './vercel-driver-fixture'

describe('createOrResume riding out the name-registry settle', () => {
  it('retries a taken name and resumes once the registry catches up, narrating the wait', async () => {
    let calls = 0
    const waits: SettleWaitNotice[] = []
    const fresh = fakeSandbox()
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          calls += 1
          if (calls < 3) throw nameTakenError()
          await params?.onCreate?.(fresh)
          return fresh
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      onSettleWait: (notice) => {
        waits.push(notice)
      },
    })

    expect(calls).toBe(3)
    expect(placement.created).toBe(true)
    expect(waits).toEqual([
      { reason: ESettleWait.NameConflict, attempt: 1, attempts: 10 },
      { reason: ESettleWait.NameConflict, attempt: 2, attempts: 10 },
    ])
  })

  it('fails with a named conflict once the settle outlives the budget', async () => {
    let calls = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 4, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          calls += 1
          throw nameTakenError()
        },
      },
    })

    const failure = await driver
      .createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })
      .catch((caught: unknown) => caught)

    expect(calls).toBe(4)
    expect(failure).toBeInstanceOf(VercelFailure)
    expect((failure as VercelFailure).kind).toBe(EVercelFailure.NameConflict)
    expect((failure as Error).message).toContain('atlas-thread-x')
  })

  it('narrates the drive detach settle the same way', async () => {
    let calls = 0
    const waits: SettleWaitNotice[] = []
    const fresh = fakeSandbox()
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async (params) => {
          calls += 1
          if (calls < 2) throw alreadyAttachedError()
          await params?.onCreate?.(fresh)
          return fresh
        },
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      onSettleWait: (notice) => {
        waits.push(notice)
      },
    })

    expect(calls).toBe(2)
    expect(waits).toEqual([{ reason: ESettleWait.DriveAttached, attempt: 1, attempts: 10 }])
  })

  it('runs no settle narration when the wake mounts on the first attempt', async () => {
    const waits: SettleWaitNotice[] = []
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => fakeSandbox(),
      },
    })

    await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
      onSettleWait: (notice) => {
        waits.push(notice)
      },
    })

    expect(waits).toEqual([])
  })
})
