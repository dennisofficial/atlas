import { describe, expect, it, mock } from 'bun:test'

import type { DriveSdk } from '../drive-lifecycle'
import {
  driveNameFor,
  DRIVE_MOUNT_PATH,
  DRIVE_WORKSPACE_PATH,
  DRIVE_HOME_PATH,
} from '../drive-names'
import { VercelDriver } from '../vercel-driver'
import { EVercelFailure, VercelFailure } from '../vercel-errors'
import {
  CREDENTIALS,
  PINNED_VERSION,
  fakeSandbox,
  fakeDriveSdk,
  driverWith,
  notFound,
  alreadyAttachedError,
} from './vercel-driver-fixture'

describe('createOrResume', () => {
  it('provisions the thread drive, mounts it, and points serve at the drive paths', async () => {
    let seen: Record<string, unknown> = {}
    const drives = fakeDriveSdk()
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          seen = params as Record<string, unknown>
          await params?.onCreate?.(fakeSandbox())
          return fakeSandbox()
        },
      },
      driveSdk: drives.sdk,
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    expect(drives.created).toEqual([driveName])
    expect(placement.driveName).toBe(driveName)
    expect(seen.mounts).toMatchObject({ [DRIVE_MOUNT_PATH]: { name: driveName } })
    expect(seen.env).toMatchObject({
      ATLAS_WORKSPACE_DIR: DRIVE_WORKSPACE_PATH,
      ATLAS_HOME: DRIVE_HOME_PATH,
    })
  })

  it('reuses and mounts an existing 50 GiB drive without requesting a new ceiling', async () => {
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    const drive = { name: driveName, maxSize: 50 * 1024 ** 3 }
    const getOrCreate = mock(async (params: Parameters<DriveSdk['getOrCreate']>[0]) => {
      if (params?.maxSize !== undefined && params.maxSize !== drive.maxSize) {
        throw new Error('drive maxSize conflicts with existing configuration')
      }
      return drive as never
    })
    const list = mock(async (_params: Parameters<DriveSdk['list']>[0]) => (async function* () {
      yield { name: `${driveName}-other`, maxSize: 1_099_511_627_776 } as never
      yield drive as never
    })())
    const drives = fakeDriveSdk({ getOrCreate, list })
    let mounted: unknown
    const { driver } = driverWith({
      sdk: {
        getOrCreate: async (params) => {
          mounted = params?.mounts?.[DRIVE_MOUNT_PATH]
          return fakeSandbox()
        },
      },
      driveSdk: drives.sdk,
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(list).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[0]?.[0]).toEqual({
      ...CREDENTIALS,
      namePrefix: driveName,
      sortBy: 'name',
      signal: expect.any(AbortSignal),
    })
    expect(getOrCreate).toHaveBeenCalledTimes(1)
    expect(getOrCreate.mock.calls[0]?.[0]?.name).toBe(driveName)
    expect(getOrCreate.mock.calls[0]?.[0]).not.toHaveProperty('maxSize')
    expect(mounted).toBe(drive)
    expect(drive.maxSize).toBe(53_687_091_200)
    expect(placement.driveName).toBe(driveName)
    expect(drives.created).toEqual([])
    expect(drives.deleted).toEqual([])
  })

  it('retries the mount through the attach-detach lag until the drive is free', async () => {
    let calls = 0
    const lines: string[] = []
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: fakeDriveSdk().sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      log: (line) => lines.push(line),
      sdk: {
        get: async () => {
          throw notFound()
        },
        getOrCreate: async () => {
          calls += 1
          if (calls < 3) throw alreadyAttachedError()
          return fakeSandbox()
        },
      },
    })

    const placement = await driver.createOrResume({
      name: 'atlas-thread-x',
      threadId: 'brn_cloud',
      token: 't',
    })

    expect(calls).toBe(3)
    expect(placement.created).toBe(false)
    expect(lines.some((line) => line.includes('still attached'))).toBe(true)
  })

  it('waits out a drive that stays attached for a few polls after the stale sandbox is deleted', async () => {
    const stale = fakeSandbox({ installedVersion: '1.19.1', status: 'stopped' })
    let listCalls = 0
    const drives = fakeDriveSdk({
      list: async () =>
        (async function* () {
          listCalls += 1
          if (listCalls < 3) {
            yield { name: 'other-drive', currentSandboxName: 'atlas-thread-y' } as never
            return
          }
          yield* [] as never[]
        })(),
    })
    let mounts = 0
    const driver = new VercelDriver({
      credentials: CREDENTIALS,
      cloudUrl: 'https://api.example.com',
      driveSdk: drives.sdk,
      image: `atlas-sandbox:${PINNED_VERSION}`,
      serveVersion: PINNED_VERSION,
      attachLagRetry: { attempts: 10, delayMs: 0 },
      runtimeHealth: async () => ({
        busy: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        pendingInput: false,
        settlingWork: false,
        clients: 0,
      }),
      sdk: {
        get: async () => stale,
        getOrCreate: async () => {
          mounts += 1
          return fakeSandbox()
        },
      },
    })

    await driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })

    expect(stale.deleted).toBe(true)
    expect(listCalls).toBe(2)
    expect(mounts).toBe(1)
  })

  it('exhausts the mount retries into a typed drive-attached failure', async () => {
    let calls = 0
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
        getOrCreate: async () => {
          calls += 1
          throw alreadyAttachedError()
        },
      },
    })

    const failure = await driver
      .createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      )

    expect(calls).toBe(10)
    expect(failure).toBeInstanceOf(VercelFailure)
    expect((failure as VercelFailure).kind).toBe(EVercelFailure.DriveAttached)
    expect((failure as VercelFailure).message).toContain('already attached')
  })

  it('does not retry a create failure that is not the attach lag', async () => {
    let calls = 0
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
        getOrCreate: async () => {
          calls += 1
          throw new Error('quota exceeded')
        },
      },
    })

    await expect(
      driver.createOrResume({ name: 'atlas-thread-x', threadId: 'brn_cloud', token: 't' }),
    ).rejects.toThrow('quota exceeded')
    expect(calls).toBe(1)
  })
})
