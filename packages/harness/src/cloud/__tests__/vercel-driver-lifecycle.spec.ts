import { describe, expect, it } from 'bun:test'

import { APIError } from '@vercel/sandbox'

import { driveNameFor, type DriveSdk } from '@dltech/atlas-wire'
import { fakeSandbox, fakeDrive, fakeDriveSdk, driverWith, notFound } from './vercel-driver-fixture'

describe('stop and destroy', () => {
  it('stops the sandbox and tolerates one already gone', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })
    await driver.stop({ name: 'x' })
    expect(sandbox.stopped).toBe(true)

    const missing = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })
    await expect(missing.driver.stop({ name: 'x' })).resolves.toBeUndefined()
  })

  it('stops the sandbox when the caller holds its live session identity', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await driver.stop({ name: 'x', sessionId: 'session-1' })

    expect(sandbox.stopped).toBe(true)
  })

  it('refuses to stop a sandbox whose live session is not the one the stop was issued for', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })

    await expect(driver.stop({ name: 'x', sessionId: 'session-old' })).rejects.toThrow(
      'refusing to stop sandbox x',
    )

    expect(sandbox.stopped).toBe(false)
  })

  it('deletes the sandbox and tolerates one already gone', async () => {
    const sandbox = fakeSandbox()
    const { driver } = driverWith({ sdk: { get: async () => sandbox } })
    await driver.destroy({ name: 'x' })
    expect(sandbox.deleted).toBe(true)

    const missing = driverWith({
      sdk: {
        get: async () => {
          throw notFound()
        },
      },
    })
    await expect(missing.driver.destroy({ name: 'x' })).resolves.toBeUndefined()
  })

  it('deletes the thread drive after the sandbox is gone', async () => {
    const sandbox = fakeSandbox()
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    const drives = fakeDriveSdk({
      list: async () =>
        (async function* () {
          yield fakeDrive({ name: driveName, deleted: drivesDeleted })
        })(),
    })
    const drivesDeleted: string[] = []
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: drives.sdk })

    await driver.destroy({ name: 'x', threadId: 'brn_cloud' })

    expect(sandbox.deleted).toBe(true)
    expect(drivesDeleted).toEqual([driveName])
  })

  it('leaves the drive alone when destroy is not told the thread', async () => {
    const sandbox = fakeSandbox()
    const drives = fakeDriveSdk()
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: drives.sdk })

    await driver.destroy({ name: 'x' })

    expect(sandbox.deleted).toBe(true)
    expect(drives.deleted).toEqual([])
  })

  it('waits for the drive to detach before deleting it', async () => {
    const sandbox = fakeSandbox()
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    const events: string[] = []
    let listCalls = 0
    const sdk: DriveSdk = {
      getOrCreate: async () => fakeDrive({ name: driveName }),
      list: async () =>
        (async function* () {
          listCalls += 1
          const attached = !sandbox.deleted || listCalls < 3
          yield {
            name: driveName,
            currentSandboxName: attached ? 'atlas-thread-x' : undefined,
            delete: async () => {
              if (attached) {
                events.push('delete-while-attached')
                throw new APIError(new Response(null, { status: 409 }), {
                  json: {
                    error: {
                      message: 'Cannot delete a drive that is currently attached to a sandbox.',
                    },
                  },
                })
              }
              events.push('delete-drive')
            },
          } as never
        })(),
    }
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: sdk })

    await driver.destroy({ name: 'x', threadId: 'brn_cloud' })

    expect(sandbox.deleted).toBe(true)
    expect(events).toEqual(['delete-drive'])
  })

  it('still attempts the drive delete when the detach outlives the wait', async () => {
    const sandbox = fakeSandbox()
    const driveName = driveNameFor({ threadId: 'brn_cloud' })
    let deleteCalls = 0
    const attachedDrive = {
      name: driveName,
      currentSandboxName: 'atlas-thread-x',
      delete: async () => {
        deleteCalls += 1
        throw new APIError(new Response(null, { status: 409 }), {
          json: {
            error: { message: 'Cannot delete a drive that is currently attached to a sandbox.' },
          },
        })
      },
    }
    const sdk: DriveSdk = {
      getOrCreate: async () => fakeDrive({ name: driveName }),
      list: async () =>
        (async function* () {
          yield attachedDrive as never
        })(),
    }
    const { driver } = driverWith({ sdk: { get: async () => sandbox }, driveSdk: sdk })

    await expect(driver.destroy({ name: 'x', threadId: 'brn_cloud' })).rejects.toThrow()

    expect(deleteCalls).toBe(10)
  })
})
