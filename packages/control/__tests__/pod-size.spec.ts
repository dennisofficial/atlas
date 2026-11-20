import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing'
const NOW = '2026-11-19T12:00:00.000Z'
const SESSION = 'session-pod-size'
const THREAD = 'thread-pod-size'

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
  it('records the desired size, bumps the generation and announces resizing', async () => {
    const { plane } = await seed()

    expect(await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4 })).toBe(1)
    expect(await podOf(plane)).toEqual({ desiredVcpus: 4, phase: 'resizing' })

    expect(await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8 })).toBe(2)
    expect(await podOf(plane)).toEqual({ desiredVcpus: 8, phase: 'resizing' })
  })

  it('records the applied size for the current generation and turns steady', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4 })

    expect(await plane.recordPodApplied({ sessionId: SESSION, vcpus: 4, generation })).toBe(true)
    expect(await podOf(plane)).toEqual({
      desiredVcpus: 4,
      actualVcpus: 4,
      phase: 'steady',
    })
  })

  it('ignores an apply for a generation a newer resize superseded', async () => {
    const { plane } = await seed()
    const first = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4 })
    await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8 })

    expect(await plane.recordPodApplied({ sessionId: SESSION, vcpus: 4, generation: first })).toBe(
      false,
    )
    expect(await podOf(plane)).toEqual({ desiredVcpus: 8, phase: 'resizing' })
  })

  it('reports a failure for the current generation and clears it on the next resize', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4 })

    expect(
      await plane.recordPodFailed({
        sessionId: SESSION,
        generation,
        error: 'sandbox refused the resize',
      }),
    ).toBe(true)
    expect(await podOf(plane)).toEqual({
      desiredVcpus: 4,
      phase: 'failed',
      error: 'sandbox refused the resize',
    })

    await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8 })
    expect(await podOf(plane)).toEqual({ desiredVcpus: 8, phase: 'resizing' })
  })

  it('holds the waiting phase until the size applies', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 8 })

    expect(await plane.recordPodWaiting({ sessionId: SESSION, generation, since: NOW })).toBe(true)
    expect(await podOf(plane)).toEqual({ desiredVcpus: 8, phase: 'waiting' })

    await plane.recordPodApplied({ sessionId: SESSION, vcpus: 8, generation })
    expect(await podOf(plane)).toEqual({ desiredVcpus: 8, actualVcpus: 8, phase: 'steady' })
  })

  it('drops the wait when a newer resize, a failure or an apply of an old generation arrives', async () => {
    const { plane } = await seed()
    const generation = await plane.recordPodDesired({ sessionId: SESSION, vcpus: 4 })
    await plane.recordPodWaiting({ sessionId: SESSION, generation, since: NOW })

    expect(
      await plane.recordPodWaiting({
        sessionId: SESSION,
        generation: generation + 1,
        since: NOW,
      }),
    ).toBe(false)
    expect(await podOf(plane)).toEqual({ desiredVcpus: 4, phase: 'waiting' })

    await plane.recordPodFailed({ sessionId: SESSION, generation, error: 'no sandbox' })
    expect(await podOf(plane)).toEqual({
      desiredVcpus: 4,
      phase: 'failed',
      error: 'no sandbox',
    })
  })

  it('leaves the status without pod state when no resize was ever asked for', async () => {
    const { plane } = await seed()

    expect(await podOf(plane)).toBeUndefined()
  })
})
