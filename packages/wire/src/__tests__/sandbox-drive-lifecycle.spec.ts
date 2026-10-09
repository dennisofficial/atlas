import { describe, expect, it, mock } from 'bun:test'

import { deleteDrive, ensureDrive, waitForDriveDetached, type DriveSdk } from '../sandbox-drive-lifecycle.js'

const CREDENTIALS = { token: 'vercel-token', teamId: 'team_1', projectId: 'prj_1' }

type FakeDrive = { name: string; currentSandboxName?: string; delete: () => Promise<void> }

const driveSdkWith = (drive: FakeDrive): DriveSdk => ({
  getOrCreate: async () => drive as never,
  list: async () => (async function* () {
    yield drive as never
  })(),
})

const attachedError = (): Error => new Error('Cannot delete a drive that is currently attached to a sandbox.')

const NO_DELAY = { attempts: 10, delayMs: 0 }

describe('ensureDrive', () => {
  it('creates a drive with an exact 1 TiB ceiling and the provisioning options', async () => {
    const drive = { name: 'atlas-drive-x', maxSize: 1_099_511_627_776 }
    const getOrCreate = mock(async (_params: Parameters<DriveSdk['getOrCreate']>[0]) => drive as never)

    const ensured = await ensureDrive({
      sdk: { ...driveSdkWith({ name: drive.name, delete: async () => {} }), getOrCreate },
      credentials: CREDENTIALS,
      name: drive.name,
      driveExisted: false,
    })

    expect<unknown>(ensured).toBe(drive)
    expect(getOrCreate).toHaveBeenCalledTimes(1)
    expect(getOrCreate.mock.calls[0]?.[0]).toEqual({
      ...CREDENTIALS,
      name: drive.name,
      region: 'iad1',
      maxSize: 1_099_511_627_776,
      signal: expect.any(AbortSignal),
    })
    expect(getOrCreate.mock.calls[0]?.[0]?.signal?.aborted).toBe(false)
  })

  it('omits maxSize when retrieving an existing 50 GiB drive', async () => {
    const drive = { name: 'atlas-drive-x', maxSize: 50 * 1024 ** 3 }
    const getOrCreate = mock(async (params: Parameters<DriveSdk['getOrCreate']>[0]) => {
      if (params?.maxSize !== undefined && params.maxSize !== drive.maxSize) {
        throw new Error('drive maxSize conflicts with existing configuration')
      }
      return drive as never
    })

    const ensured = await ensureDrive({
      sdk: { ...driveSdkWith({ name: drive.name, delete: async () => {} }), getOrCreate },
      credentials: CREDENTIALS,
      name: drive.name,
      driveExisted: true,
    })

    expect<unknown>(ensured).toBe(drive)
    expect(drive.maxSize).toBe(53_687_091_200)
    expect(getOrCreate).toHaveBeenCalledTimes(1)
    expect(getOrCreate.mock.calls[0]?.[0]).toEqual({
      ...CREDENTIALS,
      name: drive.name,
      region: 'iad1',
      signal: expect.any(AbortSignal),
    })
    expect(getOrCreate.mock.calls[0]?.[0]).not.toHaveProperty('maxSize')
    expect(getOrCreate.mock.calls[0]?.[0]?.signal?.aborted).toBe(false)
  })
})

describe('deleteDrive', () => {
  it('retries through the attach-detach lag until the drive deletes', async () => {
    let calls = 0
    const drive: FakeDrive = {
      name: 'atlas-drive-x',
      delete: async () => {
        calls += 1
        if (calls < 3) throw attachedError()
      },
    }

    await deleteDrive({
      sdk: driveSdkWith(drive),
      credentials: CREDENTIALS,
      name: 'atlas-drive-x',
      retry: NO_DELAY,
    })

    expect(calls).toBe(3)
  })

  it('does not retry a failure that is not the attach lag', async () => {
    let calls = 0
    const drive: FakeDrive = {
      name: 'atlas-drive-x',
      delete: async () => {
        calls += 1
        throw new Error('a real failure')
      },
    }

    await expect(
      deleteDrive({ sdk: driveSdkWith(drive), credentials: CREDENTIALS, name: 'atlas-drive-x' }),
    ).rejects.toThrow('a real failure')
    expect(calls).toBe(1)
  })
})

describe('waitForDriveDetached', () => {
  it('polls until the deleted sandbox lets the drive go', async () => {
    let polls = 0
    const drive: FakeDrive = { name: 'atlas-drive-x', delete: async () => {} }
    const sdk: DriveSdk = {
      getOrCreate: async () => drive as never,
      list: async () => (async function* () {
        polls += 1
        if (polls < 3) yield { ...drive, currentSandboxName: 'atlas-thread-x' } as never
        else yield { ...drive } as never
      })(),
    }

    const detached = await waitForDriveDetached({
      sdk,
      credentials: CREDENTIALS,
      name: 'atlas-drive-x',
      retry: NO_DELAY,
    })

    expect(detached).toBe(true)
    expect(polls).toBe(3)
  })

  it('answers detached when the drive is gone outright', async () => {
    const sdk: DriveSdk = {
      getOrCreate: async () => ({ name: 'atlas-drive-x' }) as never,
      list: async () => (async function* () {
        yield* [] as never[]
      })(),
    }

    const detached = await waitForDriveDetached({
      sdk,
      credentials: CREDENTIALS,
      name: 'atlas-drive-x',
    })

    expect(detached).toBe(true)
  })

  it('gives up after the poll budget when a sandbox never lets go', async () => {
    const drive: FakeDrive = {
      name: 'atlas-drive-x',
      currentSandboxName: 'atlas-thread-x',
      delete: async () => {},
    }

    const detached = await waitForDriveDetached({
      sdk: driveSdkWith(drive),
      credentials: CREDENTIALS,
      name: 'atlas-drive-x',
      retry: NO_DELAY,
    })

    expect(detached).toBe(false)
  })
})
