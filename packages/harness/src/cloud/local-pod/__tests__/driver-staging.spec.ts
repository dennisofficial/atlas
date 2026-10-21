import { describe, expect, it } from 'vitest'

import { dindVolumeNameFor, workspaceVolumeNameFor } from '../pod-create'
import { POD_STAGED_PATH } from '../pod-staged'
import { driverWith, fakeEngine, NAME, THREAD } from './fake-pod-engine'

describe('DockerPodDriver staging, recovery and locking', () => {
  it('re-stages a present pod that never got its marker and reports it as created', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'exited' }, staged: false })
    const staged: string[] = []
    const driver = driverWith({ engine: fake.engine })

    const placement = await driver.createOrResume({
      name: NAME,
      threadId: THREAD,
      token: 'tok',
      putContextOnFreshBoot: async (handle) => {
        staged.push(handle.name)
      },
    })

    expect(placement.created).toBe(true)
    expect(staged).toEqual([NAME])
    expect(fake.files).toEqual([{ id: 'old-id', path: POD_STAGED_PATH, mode: 0o600 }])
    expect(fake.calls).not.toContain('create')
  })

  it('does not remove a pre-existing unmarked pod when re-staging fails', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'exited' }, staged: false })
    const original = new Error('staging broke')
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver
      .createOrResume({
        name: NAME,
        threadId: THREAD,
        token: 'tok',
        putContextOnFreshBoot: async () => {
          throw original
        },
      })
      .catch((e: unknown) => e)

    expect(failure).toBe(original)
    expect(fake.calls.some((call) => call.startsWith('remove'))).toBe(false)
    expect(fake.files).toEqual([])
  })

  it('throws instead of guessing when the marker probe fails to run', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'exited' }, markerProbeExitCode: 126 })
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch((e: unknown) => e)

    expect((failure as Error).message).toContain('could not check whether pod')
    expect(fake.files).toEqual([])
  })

  it('removes a container whose create response was lost, then its volumes, and rethrows', async () => {
    const fake = fakeEngine({ loseCreateResponse: true })
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch((e: unknown) => e)

    expect((failure as Error).message).toBe('connection reset')
    const removals = fake.calls.filter((call) => call.startsWith('remove'))
    expect(removals).toEqual([
      `removePod:fresh-id`,
      `removeVolume:${workspaceVolumeNameFor({ threadId: THREAD })}`,
      `removeVolume:${dindVolumeNameFor({ threadId: THREAD })}`,
    ])
  })

  it('only removes volumes when a failed create left no container behind', async () => {
    const fake = fakeEngine()
    const driver = driverWith({
      engine: {
        ...fake.engine,
        createContainer: async () => {
          throw new Error('daemon said no')
        },
      },
    })

    await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch(() => undefined)

    expect(fake.calls.some((call) => call.startsWith('removePod'))).toBe(false)
    expect(fake.calls.filter((call) => call.startsWith('removeVolume'))).toHaveLength(2)
  })

  it('resolves the dev serve again on every provision', async () => {
    const versions = ['dev-1', 'dev-2']
    let resolved = 0
    const desired: Array<string | undefined> = []
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'running' } })
    const driver = driverWith({
      engine: fake.engine,
      devServe: async () => {
        const version = versions[resolved++]!
        return { version, path: `/tmp/${version}`, sha256: 'x', bytes: 1 }
      },
      launchServe: async (args) => {
        desired.push(args.desiredVersion)
        return {}
      },
    })

    const first = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' })
    const second = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' })

    expect(desired).toEqual(['dev-1', 'dev-2'])
    expect([first.serveVersion, second.serveVersion]).toEqual(['dev-1', 'dev-2'])
  })

  it('provisions inside the injected lock, keyed by pod name', async () => {
    const fake = fakeEngine()
    const locked: string[] = []
    const driver = driverWith({
      engine: fake.engine,
      provisionLock: async (args) => {
        locked.push(args.name)
        expect(fake.calls).toEqual([])
        return args.run()
      },
    })

    await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' })

    expect(locked).toEqual([NAME])
  })
})
