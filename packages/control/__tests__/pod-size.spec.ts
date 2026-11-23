import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing'
const NOW = '2026-11-19T12:00:00.000Z'
const SESSION = 'session-pod-size'
const THREAD = 'thread-pod-size'

const AGENT37_SIZING = {
  cap: 8,
  offered: [
    { vcpus: 2, memoryGb: 4 },
    { vcpus: 4, memoryGb: 8 },
    { vcpus: 4, memoryGb: 16 },
    { vcpus: 4, memoryGb: 32 },
    { vcpus: 8, memoryGb: 64 },
  ],
  unavailable: [],
}

const seed = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: null,
    mainThreadId: THREAD,
  })
  return { plane }
}

const podOf = async (plane: ControlPlane) =>
  (await plane.readSessionView({ sessionId: SESSION, threadId: THREAD })).value.status.pod

describe('pod size', () => {
  it('records the desired shape, bumps the generation and announces resizing', async () => {
    const { plane } = await seed()

    expect(await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4, memoryGb: 8 })).toBe(1)
    expect(await podOf(plane)).toEqual({
      desiredShape: { vcpus: 4, memoryGb: 8 },
      desiredVcpus: 4,
      phase: 'resizing',
      sizing: AGENT37_SIZING,
    })

    expect(await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8, memoryGb: 64 })).toBe(2)
    expect(await podOf(plane)).toEqual({
      desiredShape: { vcpus: 8, memoryGb: 64 },
      desiredVcpus: 8,
      phase: 'resizing',
      sizing: AGENT37_SIZING,
    })
  })

  it('keeps the memory of a 4 vCPU pod, which is not 2 GB a vCPU on Agent37', async () => {
    const { plane } = await seed()

    await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4, memoryGb: 32 })

    expect((await podOf(plane))?.desiredShape).toEqual({ vcpus: 4, memoryGb: 32 })
  })

  it('records the applied shape for the current generation and turns steady', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4, memoryGb: 16 })

    expect(
      await plane.recordPodApplied({ sessionId: SESSION, vcpus: 4, memoryGb: 16, generation }),
    ).toBe(true)
    expect(await podOf(plane)).toEqual({
      shape: { vcpus: 4, memoryGb: 16 },
      actualVcpus: 4,
      desiredShape: { vcpus: 4, memoryGb: 16 },
      desiredVcpus: 4,
      phase: 'steady',
      sizing: AGENT37_SIZING,
    })
  })

  it('ignores an apply for a generation a newer resize superseded', async () => {
    const { plane } = await seed()
    const first = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4, memoryGb: 8 })
    await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8, memoryGb: 64 })

    expect(
      await plane.recordPodApplied({
        sessionId: SESSION,
        vcpus: 4,
        memoryGb: 8,
        generation: first,
      }),
    ).toBe(false)
    expect(await podOf(plane)).toEqual({
      desiredShape: { vcpus: 8, memoryGb: 64 },
      desiredVcpus: 8,
      phase: 'resizing',
      sizing: AGENT37_SIZING,
    })
  })

  it('reports a failure for the current generation and clears it on the next resize', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4, memoryGb: 8 })

    expect(
      await plane.recordPodFailed({
        sessionId: SESSION,
        generation,
        error: 'sandbox refused the resize',
      }),
    ).toBe(true)
    expect(await podOf(plane)).toEqual({
      desiredShape: { vcpus: 4, memoryGb: 8 },
      desiredVcpus: 4,
      phase: 'failed',
      error: 'sandbox refused the resize',
      sizing: AGENT37_SIZING,
    })

    await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8, memoryGb: 64 })
    expect((await podOf(plane))?.phase).toBe('resizing')
    expect((await podOf(plane))?.error).toBeUndefined()
  })

  it('holds the waiting phase until the shape applies', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8, memoryGb: 64 })

    expect(await plane.recordPodWaiting({ sessionId: SESSION, generation, since: NOW })).toBe(true)
    expect((await podOf(plane))?.phase).toBe('waiting')

    await plane.recordPodApplied({ sessionId: SESSION, vcpus: 8, memoryGb: 64, generation })
    expect(await podOf(plane)).toMatchObject({
      shape: { vcpus: 8, memoryGb: 64 },
      phase: 'steady',
    })
  })

  it('drops the wait when a newer resize, a failure or an apply of an old generation arrives', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4, memoryGb: 8 })
    await plane.recordPodWaiting({ sessionId: SESSION, generation, since: NOW })

    expect(
      await plane.recordPodWaiting({
        sessionId: SESSION,
        generation: generation + 1,
        since: NOW,
      }),
    ).toBe(false)
    expect((await podOf(plane))?.phase).toBe('waiting')

    await plane.recordPodFailed({ sessionId: SESSION, generation, error: 'no sandbox' })
    expect(await podOf(plane)).toMatchObject({
      desiredShape: { vcpus: 4, memoryGb: 8 },
      phase: 'failed',
      error: 'no sandbox',
    })
  })

  it('offers the provider shapes before any resize was ever asked for', async () => {
    const { plane } = await seed()

    expect(await podOf(plane)).toEqual({ phase: 'steady', sizing: AGENT37_SIZING })
  })

  it('records the disk a pod was created with, without asking for a resize', async () => {
    const { plane } = await seed()

    expect(await plane.recordPodDisk({ sessionId: SESSION, diskGb: 80 })).toBe(true)

    const session = await plane.readSession({ sessionId: SESSION })
    expect(session?.podDesiredDiskGb).toBe(80)
    expect(session?.podSizeGeneration).toBe(0)
    expect(session?.podResizeError).toBeNull()
    expect(await podOf(plane)).toEqual({ phase: 'steady', diskGb: 80, sizing: AGENT37_SIZING })
  })

  it('leaves an unknown session alone', async () => {
    const { plane } = await seed()

    expect(await plane.recordPodDisk({ sessionId: 'missing', diskGb: 80 })).toBe(false)
  })

  it('reports no disk until a pod row records one', async () => {
    const { plane } = await seed()

    expect((await podOf(plane))?.diskGb).toBeUndefined()
  })
})
