import { describe, expect, it } from 'bun:test'

import { deleteDrive, type DriveSdk } from '../drive-lifecycle'

const CREDENTIALS = { token: 'vercel-token', teamId: 'team_1', projectId: 'prj_1' }

type FakeDrive = { name: string; delete: () => Promise<void> }

const driveSdkWith = (drive: FakeDrive): DriveSdk => ({
  getOrCreate: async () => drive as never,
  list: async () => (async function* () {
    yield drive as never
  })(),
})

const attachedError = (): Error => new Error('Cannot delete a drive that is currently attached to a sandbox.')

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

    await deleteDrive({ sdk: driveSdkWith(drive), credentials: CREDENTIALS, name: 'atlas-drive-x' })

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
