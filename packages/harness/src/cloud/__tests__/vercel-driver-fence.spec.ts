import { describe, expect, it } from 'bun:test'

import { driveNameFor } from '../drive-names'
import type { DriveSdk } from '../drive-lifecycle'
import { driverWith, fakeDrive, fakeSandbox, notFound } from './vercel-driver-fixture'
import type { VercelSdk } from '../vercel-driver'

const THREAD = 'brn_cloud'

type Observed = { getOptions: unknown[]; drivesDeleted: string[]; listCalls: () => number }

const attachedDriveSdk = ({ attachedTo }: { attachedTo: string | undefined }): { sdk: DriveSdk } & Observed => {
  const drivesDeleted: string[] = []
  let listCalls = 0
  const name = driveNameFor({ threadId: THREAD })
  const sdk: DriveSdk = {
    getOrCreate: async () => fakeDrive({ name }),
    list: async () =>
      (async function* () {
        listCalls += 1
        yield {
          name,
          currentSandboxName: attachedTo,
          delete: async () => {
            drivesDeleted.push(name)
          },
        } as never
      })(),
  }
  return { sdk, getOptions: [], drivesDeleted, listCalls: () => listCalls }
}

const sdkReturning = ({ sandbox, options }: { sandbox: Awaited<ReturnType<VercelSdk['get']>>; options: unknown[] }): Partial<VercelSdk> => ({
  get: async (params) => {
    options.push(params)
    return sandbox
  },
})

describe('generation-fenced destroy', () => {
  it('deletes the sandbox and its detached drive when the live session matches', async () => {
    const sandbox = fakeSandbox()
    const drives = attachedDriveSdk({ attachedTo: undefined })
    const options: unknown[] = []
    const { driver } = driverWith({ sdk: sdkReturning({ sandbox, options }), driveSdk: drives.sdk })

    await driver.destroy({ name: 'x', threadId: THREAD, sessionId: 'session-1' })

    expect(sandbox.deleted).toBe(true)
    expect(drives.drivesDeleted).toEqual([driveNameFor({ threadId: THREAD })])
    expect(options).toEqual([expect.objectContaining({ name: 'x', resume: false })])
  })

  it('refuses a replacement session before deleting the sandbox or touching the drive', async () => {
    const sandbox = fakeSandbox()
    const drives = attachedDriveSdk({ attachedTo: 'x' })
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: drives.sdk })

    await expect(driver.destroy({ name: 'x', threadId: THREAD, sessionId: 'session-old' })).rejects.toThrow(
      'refusing to stop sandbox x',
    )

    expect(sandbox.deleted).toBe(false)
    expect(drives.listCalls()).toBe(0)
    expect(drives.drivesDeleted).toEqual([])
  })

  it('refuses when the expected sandbox is gone, leaving the drive alone', async () => {
    const drives = attachedDriveSdk({ attachedTo: undefined })
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
      driveSdk: drives.sdk,
    })

    await expect(driver.destroy({ name: 'x', threadId: THREAD, sessionId: 'session-1' })).rejects.toThrow(
      'no longer exists',
    )

    expect(drives.listCalls()).toBe(0)
    expect(drives.drivesDeleted).toEqual([])
  })

  it('keeps a drive that a replacement session has attached after the delete', async () => {
    const sandbox = fakeSandbox()
    const drives = attachedDriveSdk({ attachedTo: 'x' })
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: drives.sdk })

    await expect(driver.destroy({ name: 'x', threadId: THREAD, sessionId: 'session-1' })).rejects.toThrow(
      'it is kept because a replacement session may hold it',
    )

    expect(sandbox.deleted).toBe(true)
    expect(drives.drivesDeleted).toEqual([])
  })

  it('deletes only the sandbox when no thread is named', async () => {
    const sandbox = fakeSandbox()
    const drives = attachedDriveSdk({ attachedTo: undefined })
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: drives.sdk })

    await driver.destroy({ name: 'x', sessionId: 'session-1' })

    expect(sandbox.deleted).toBe(true)
    expect(drives.listCalls()).toBe(0)
  })
})

describe('unfenced destroy keeps its idempotent behaviour', () => {
  it('tolerates a missing sandbox and still deletes the drive, repeatedly', async () => {
    const drives = attachedDriveSdk({ attachedTo: undefined })
    const { driver } = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
      driveSdk: drives.sdk,
    })

    await driver.destroy({ name: 'x', threadId: THREAD })
    await driver.destroy({ name: 'x', threadId: THREAD })

    expect(drives.drivesDeleted).toHaveLength(2)
  })

  it('does not ask for a session-fenced lookup', async () => {
    const options: unknown[] = []
    const { driver } = driverWith({ sdk: sdkReturning({ sandbox: fakeSandbox(), options }) })

    await driver.destroy({ name: 'x' })

    expect(options[0]).not.toHaveProperty('resume')
  })
})
