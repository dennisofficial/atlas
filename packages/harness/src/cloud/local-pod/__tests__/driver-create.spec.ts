import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION, UNSTAMPED_PROTOCOL } from '@dltech/atlas-wire'

import { POD_INGRESS_CONTAINER_PORT } from '../ingress'
import { dindVolumeNameFor, podRoleLabel, podThreadLabel, POD_ROLE, workspaceVolumeNameFor } from '../pod-create'
import { POD_STAGED_PATH } from '../pod-staged'
import type { PodServeLauncher } from '../serve-launch'
import { driverWith, fakeEngine, INGRESS_HOST_PORT, NAME, SERVE_HOST_PORT, THREAD } from './fake-pod-engine'

describe('DockerPodDriver createOrResume', () => {
  it('boots a fresh pod: volumes, container, start, ingress, staging, then serve launch', async () => {
    const fake = fakeEngine()
    const order: string[] = []
    const launches: Array<Parameters<PodServeLauncher>[0]> = []
    const driver = driverWith({
      engine: {
        ...fake.engine,
        execSh: async (args) => {
          order.push('ingress-probe')
          return fake.engine.execSh(args)
        },
      },
      desiredVersion: '1.2.3',
      launchServe: async (args) => {
        order.push('launch')
        launches.push(args)
        return {}
      },
    })

    const placement = await driver.createOrResume({
      name: NAME,
      threadId: THREAD,
      token: 'tok',
      putContextOnFreshBoot: async (handle) => {
        order.push(`stage:${handle.name}`)
      },
    })

    expect(fake.calls.filter((call) => call !== 'inspect')).toEqual([
      'list',
      'volume',
      'volume',
      'create',
      'start:fresh-id',
      'writeFile',
    ])
    expect(order).toEqual(['ingress-probe', `stage:${NAME}`, 'launch'])
    expect(fake.files).toEqual([{ id: 'fresh-id', path: POD_STAGED_PATH, mode: 0o600 }])
    expect(fake.volumes.map((volume) => volume.name)).toEqual([
      workspaceVolumeNameFor({ threadId: THREAD }),
      dindVolumeNameFor({ threadId: THREAD }),
    ])
    expect(fake.volumes.every((volume) => volume.labels[podThreadLabel] === THREAD)).toBe(true)
    expect(fake.volumes.every((volume) => volume.labels[podRoleLabel] === POD_ROLE)).toBe(true)
    expect(fake.created[0]?.name).toBe(NAME)
    expect(fake.created[0]?.body.Env).toContain('ATLAS_SERVE_TOKEN=tok')
    expect(placement).toEqual({
      url: `http://127.0.0.1:${SERVE_HOST_PORT}`,
      state: 'running',
      created: true,
      token: 'tok',
      serveVersion: '1.2.3',
    })
    expect(launches[0]).toMatchObject({
      id: 'fresh-id',
      name: NAME,
      token: 'tok',
      cloudUrl: 'http://cloud.test',
      desiredVersion: '1.2.3',
    })
  })

  it('writes the staged marker even when there is no staging hook', async () => {
    const fake = fakeEngine()
    const driver = driverWith({ engine: fake.engine })

    await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' })

    expect(fake.files.map((file) => file.path)).toEqual([POD_STAGED_PATH])
  })

  it('mints a token when a fresh boot is given none', async () => {
    const fake = fakeEngine()
    const driver = driverWith({ engine: fake.engine })

    const placement = await driver.createOrResume({ name: NAME, threadId: THREAD })

    expect(placement.token).toMatch(/^[0-9a-f]{64}$/)
    expect(fake.created[0]?.body.Env).toContain(`ATLAS_SERVE_TOKEN=${placement.token}`)
  })

  it('resumes a marked exited pod without creating or staging', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'exited' } })
    let staged = false
    const driver = driverWith({ engine: fake.engine })

    const placement = await driver.createOrResume({
      name: NAME,
      threadId: THREAD,
      token: 'tok',
      putContextOnFreshBoot: async () => {
        staged = true
      },
    })

    expect(placement.created).toBe(false)
    expect(placement.url).toBe(`http://127.0.0.1:${SERVE_HOST_PORT}`)
    expect(staged).toBe(false)
    expect(fake.calls).not.toContain('create')
    expect(fake.calls).not.toContain('volume')
    expect(fake.calls).toContain('start:old-id')
    expect(fake.files).toEqual([])
  })

  it('refuses to resume without the token the caller minted', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'exited' } })
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver.createOrResume({ name: NAME, threadId: THREAD }).catch((error: unknown) => error)

    expect((failure as Error).message).toContain('needs the serve token')
    expect(fake.calls).not.toContain('start:old-id')
  })

  it('falls through to start when another process won the create race', async () => {
    const fake = fakeEngine({ conflictOnCreate: true })
    const driver = driverWith({ engine: fake.engine })

    const placement = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' })

    expect(placement.created).toBe(false)
    expect(fake.calls).toContain('start:rival-id')
    expect(fake.calls.some((call) => call.startsWith('removePod'))).toBe(false)
  })

  it('maps a swap onto rotatedFrom and rotatedProtocol and forwards the rotation hook', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'running' } })
    let rotationStarted = false
    const driver = driverWith({
      engine: fake.engine,
      launchServe: async (args) => {
        args.onSwapStarted?.()
        return { swapped: { fromVersion: '0.9.0', fromProtocol: 7 } }
      },
    })

    const placement = await driver.createOrResume({
      name: NAME,
      threadId: THREAD,
      token: 'tok',
      onRotationStarted: () => {
        rotationStarted = true
      },
    })

    expect(rotationStarted).toBe(true)
    expect(placement).toMatchObject({ rotatedFrom: '0.9.0', rotatedProtocol: 7 })
  })

  it.each([UNSTAMPED_PROTOCOL, CHANNEL_PROTOCOL_VERSION])(
    'omits rotatedProtocol when the old protocol is %d',
    async (fromProtocol) => {
      const fake = fakeEngine({ existing: { id: 'old-id', status: 'running' } })
      const driver = driverWith({
        engine: fake.engine,
        launchServe: async () => ({ swapped: { fromVersion: undefined, fromProtocol } }),
      })

      const placement = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' })

      expect('rotatedProtocol' in placement).toBe(false)
      expect('rotatedFrom' in placement).toBe(false)
    },
  )

  it('rolls back a fresh pod and its volumes when the launch fails, rethrowing the original', async () => {
    const fake = fakeEngine()
    const original = new Error('serve never became healthy')
    const driver = driverWith({
      engine: fake.engine,
      launchServe: async () => {
        throw original
      },
    })

    const failure = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch((e: unknown) => e)

    expect(failure).toBe(original)
    expect(fake.calls).toContain('removePod:fresh-id')
    expect(fake.calls).toContain(`removeVolume:${workspaceVolumeNameFor({ threadId: THREAD })}`)
    expect(fake.calls).toContain(`removeVolume:${dindVolumeNameFor({ threadId: THREAD })}`)
  })

  it('rolls back when staging fails on a fresh boot', async () => {
    const fake = fakeEngine()
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
    expect(fake.calls).toContain('removePod:fresh-id')
  })

  it('keeps the original error when the rollback itself fails', async () => {
    const fake = fakeEngine({ failVolumeRemoval: true })
    const logged: string[] = []
    const original = new Error('launch failed')
    const driver = driverWith({
      engine: fake.engine,
      log: (line) => logged.push(line),
      launchServe: async () => {
        throw original
      },
    })

    const failure = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch((e: unknown) => e)

    expect(failure).toBe(original)
    expect(logged.some((line) => line.includes('volume busy'))).toBe(true)
  })

  it('never removes a resumed pod when the launch fails', async () => {
    const fake = fakeEngine({ existing: { id: 'old-id', status: 'exited' } })
    const driver = driverWith({
      engine: fake.engine,
      launchServe: async () => {
        throw new Error('launch failed')
      },
    })

    await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch(() => undefined)

    expect(fake.calls.some((call) => call.startsWith('remove'))).toBe(false)
  })

  it('throws when the pod publishes no serve host port', async () => {
    const fake = fakeEngine({
      existing: { id: 'old-id', status: 'exited' },
      podDetails: { ports: [{ containerPort: POD_INGRESS_CONTAINER_PORT, hostPort: INGRESS_HOST_PORT }] },
    })
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }).catch((e: unknown) => e)

    expect((failure as Error).message).toContain('publishes no host port')
  })

  it('shares one provision between concurrent wakes of the same pod', async () => {
    const fake = fakeEngine()
    let launches = 0
    const driver = driverWith({
      engine: fake.engine,
      launchServe: async () => {
        launches += 1
        await Bun.sleep(20)
        return {}
      },
    })

    const [first, second] = await Promise.all([
      driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }),
      driver.createOrResume({ name: NAME, threadId: THREAD, token: 'tok' }),
    ])

    expect(launches).toBe(1)
    expect(second).toBe(first)
  })
})
