import { afterEach, describe, expect, it } from 'vitest'

import { EngineRequestFailed } from '../engine-http'
import { cleanupDaemons, serveDaemon } from './fake-pod-daemon'

afterEach(cleanupDaemons)

describe('DockerPodEngine pod lifecycle', () => {
  const inspectBody = {
    Id: 'abc123',
    Name: '/atlas-pod-one',
    State: { Status: 'running', Running: true },
    Config: { Labels: { 'atlas-pod.thread': 't1', numeric: 1 } },
    HostConfig: { NanoCpus: 2_000_000_000, MemoryReservation: 536_870_912 },
    NetworkSettings: {
      Ports: {
        '7777/tcp': [{ HostIp: '127.0.0.1', HostPort: '20123' }],
        '7676/tcp': [{ HostIp: '127.0.0.1', HostPort: '20456' }],
        '9999/tcp': null,
      },
    },
  }

  it('inspects a pod by name into the details the driver needs', async () => {
    const { engine, requests } = await serveDaemon(() => Response.json(inspectBody))

    const pod = await engine.inspectPod({ id: 'atlas-pod-one' })

    expect(requests[0]).toMatchObject({ method: 'GET', path: '/containers/atlas-pod-one/json' })
    expect(pod).toEqual({
      id: 'abc123',
      name: 'atlas-pod-one',
      status: 'running',
      running: true,
      labels: { 'atlas-pod.thread': 't1' },
      ports: [
        { containerPort: 7777, hostPort: 20123 },
        { containerPort: 7676, hostPort: 20456 },
      ],
      nanoCpus: 2_000_000_000,
      memoryReservationBytes: 536_870_912,
    })
  })

  it('reads published ports from the host config while the pod is stopped', async () => {
    const { engine } = await serveDaemon(() =>
      Response.json({
        ...inspectBody,
        State: { Status: 'exited', Running: false },
        NetworkSettings: { Ports: {} },
        HostConfig: {
          PortBindings: { '7777/tcp': [{ HostIp: '127.0.0.1', HostPort: '20123' }] },
        },
      }),
    )

    const pod = await engine.inspectPod({ id: 'abc' })

    expect(pod).toMatchObject({
      status: 'exited',
      running: false,
      ports: [{ containerPort: 7777, hostPort: 20123 }],
      nanoCpus: 0,
      memoryReservationBytes: 0,
    })
  })

  it('answers undefined for a pod the daemon has never heard of', async () => {
    const { engine } = await serveDaemon(() =>
      Response.json({ message: 'No such container: abc' }, { status: 404 }),
    )

    expect(await engine.inspectPod({ id: 'abc' })).toBeUndefined()
  })

  it('lets any other inspect failure surface', async () => {
    const { engine } = await serveDaemon(() => Response.json({ message: 'boom' }, { status: 500 }))

    const failure = await engine.inspectPod({ id: 'abc' }).catch((error: unknown) => error)

    expect((failure as EngineRequestFailed).status).toBe(500)
  })

  it('starts a pod', async () => {
    const { engine, requests } = await serveDaemon(() => new Response(null, { status: 204 }))

    await engine.startPod({ id: 'abc' })

    expect(requests[0]).toMatchObject({ method: 'POST', path: '/containers/abc/start' })
  })

  it('treats starting an already-running pod as success', async () => {
    const { engine } = await serveDaemon(() => new Response(null, { status: 304 }))

    await engine.startPod({ id: 'abc' })
  })

  it('rejects when starting fails for any other reason', async () => {
    const { engine } = await serveDaemon(() =>
      Response.json({ message: 'port is already allocated' }, { status: 500 }),
    )

    const failure = await engine.startPod({ id: 'abc' }).catch((error: unknown) => error)

    expect((failure as EngineRequestFailed).status).toBe(500)
  })

  it('force-removes a pod with its anonymous volumes', async () => {
    const { engine, requests } = await serveDaemon(() => new Response(null, { status: 204 }))

    await engine.removePod({ id: 'abc' })

    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/containers/abc',
      query: { force: '1', v: '1' },
    })
  })

  it('treats removing a missing pod as removed', async () => {
    const { engine } = await serveDaemon(() =>
      Response.json({ message: 'No such container: abc' }, { status: 404 }),
    )

    await engine.removePod({ id: 'abc' })
  })
})
