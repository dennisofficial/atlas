import { describe, expect, it } from 'vitest'

import type { SandboxStateWire } from '@dltech/atlas-wire'

import { driverWith, fakeEngine, GIB, NAME, SERVE_HOST_PORT, THREAD } from './fake-pod-engine'

describe('DockerPodDriver name check', () => {
  it('refuses a name that does not belong to the thread', async () => {
    const fake = fakeEngine()
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver
      .createOrResume({ name: 'atlas-pod-other', threadId: THREAD, token: 'tok' })
      .catch((e: unknown) => e)

    expect((failure as Error).message).toContain('does not belong to thread')
    expect(fake.calls).toEqual([])
  })
})

describe('DockerPodDriver observation and resources', () => {
  it.each<[string, SandboxStateWire]>([
    ['running', 'running'],
    ['restarting', 'resuming'],
    ['created', 'parked'],
    ['exited', 'parked'],
    ['paused', 'parked'],
    ['dead', 'stopped'],
    ['removing', 'stopped'],
    ['mystery', 'unknown'],
  ])('reports docker status %s as %s', async (status, expected) => {
    const fake = fakeEngine({ existing: { id: 'id-1', status } })
    const driver = driverWith({ engine: fake.engine })

    const observed = await driver.inspect({ name: NAME })

    expect(observed?.state).toBe(expected)
    expect(observed?.url).toBe(expected === 'running' ? `http://127.0.0.1:${SERVE_HOST_PORT}` : undefined)
  })

  it('observes a missing pod as undefined', async () => {
    const driver = driverWith({ engine: fakeEngine().engine })

    expect(await driver.inspect({ name: NAME })).toBeUndefined()
  })

  it('updates the cpu quota and memory reservation, never a hard memory limit', async () => {
    const fake = fakeEngine()
    const driver = driverWith({ engine: fake.engine })

    await driver.updateResources({ name: NAME, vcpus: 1 })

    expect(fake.updates).toEqual([{ id: NAME, nanoCpus: 1e9, memoryReservationBytes: 2 * GIB }])
  })

  it('reads resources back as vcpus and memoryMb', async () => {
    const fake = fakeEngine({
      existing: { id: 'id-1', status: 'running' },
      podDetails: { nanoCpus: 2e9, memoryReservationBytes: 4 * GIB },
    })
    const driver = driverWith({ engine: fake.engine })

    expect(await driver.readResources({ name: NAME })).toEqual({ vcpus: 2, memoryMb: 4096 })
  })

  it('omits resources the pod does not set and answers empty for a missing pod', async () => {
    const present = driverWith({ engine: fakeEngine({ existing: { id: 'id-1', status: 'running' } }).engine })
    const missing = driverWith({ engine: fakeEngine().engine })

    expect(await present.readResources({ name: NAME })).toEqual({})
    expect(await missing.readResources({ name: NAME })).toEqual({})
  })
})

describe('DockerPodDriver bootstrap files and destroy', () => {
  it('creates the parent directory in the guest then writes the file with a private mode', async () => {
    const fake = fakeEngine()
    const driver = driverWith({ engine: fake.engine })

    await driver.writeBootstrapFile({ name: NAME, path: '/root/.atlas/bootstrap/spec.json', content: '{}' })

    expect(fake.scripts).toHaveLength(1)
    expect(fake.scripts[0]).toStartWith('timeout -k 5 20 sh -c ')
    expect(fake.scripts[0]).toContain('mkdir -p')
    expect(fake.scripts[0]).toContain('/root/.atlas/bootstrap')
    expect(fake.files).toEqual([{ id: NAME, path: '/root/.atlas/bootstrap/spec.json', mode: 0o600 }])
  })

  it('fails loudly when the directory cannot be created', async () => {
    const fake = fakeEngine()
    const driver = driverWith({
      engine: {
        ...fake.engine,
        execSh: async () => ({ exitCode: 1, stdout: async () => '', stderr: async () => 'read-only' }),
      },
    })

    const failure = await driver
      .writeBootstrapFile({ name: NAME, path: '/a/b', content: 'x' })
      .catch((e: unknown) => e)

    expect((failure as Error).message).toContain('read-only')
    expect(fake.files).toEqual([])
  })

  it('removes the container then both volumes', async () => {
    const fake = fakeEngine()
    const driver = driverWith({ engine: fake.engine })

    await driver.destroy({ name: NAME, sessionId: 'ignored' })

    expect(fake.calls).toEqual([
      `removePod:${NAME}`,
      `removeVolume:${NAME}-workspace`,
      `removeVolume:${NAME}-docker`,
    ])
  })

  it('still removes the docker volume when the workspace volume cannot be removed, then reports it', async () => {
    const fake = fakeEngine({ failVolumeRemovalOf: `${NAME}-workspace` })
    const driver = driverWith({ engine: fake.engine })

    const failure = await driver.destroy({ name: NAME }).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).message).toBe(`destroy of pod ${NAME} left resources behind`)
    expect((failure as AggregateError).errors).toHaveLength(1)
    expect(fake.calls).toEqual([
      `removePod:${NAME}`,
      `removeVolume:${NAME}-workspace`,
      `removeVolume:${NAME}-docker`,
    ])
  })
})
