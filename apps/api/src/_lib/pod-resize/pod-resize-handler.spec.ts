import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import type { JobDispatch, JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { podResizeHandlerOf } from './pod-resize-handler'

const NOW = '2026-11-03T12:00:00.000Z'

class RecordingDispatcher {
  readonly dispatches: { payload: unknown; idempotencyKey: string }[] = []

  async dispatch(args: JobDispatch<never>): Promise<{ runId: string }> {
    this.dispatches.push({ payload: args.payload, idempotencyKey: args.idempotencyKey })
    return { runId: 'run_stub' }
  }
}

const setup = async (over: { sandboxProvider?: string } = {}) => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: 's-1',
    userId: 'user-a',
    projectId: 'proj-a',
    mainThreadId: 't-1',
    sandboxProvider: over.sandboxProvider ?? 'vercel',
  })
  const dispatcher = new RecordingDispatcher()
  const handler = podResizeHandlerOf({
    plane,
    dispatcher: dispatcher as unknown as JobsProjectDispatcher,
  })
  const resize = (args: unknown) => handler({ plane, sessionId: 's-1', args })
  return { plane, dispatcher, resize }
}

describe('podResizeHandlerOf', () => {
  it('records the desired shape and dispatches the apply once for a shape within the limit', async () => {
    const { plane, dispatcher, resize } = await setup()

    await resize({ vcpus: 4, memoryGb: 8 })

    expect((await plane.readSession({ sessionId: 's-1' }))?.podDesiredVcpus).toBe(4)
    expect(dispatcher.dispatches).toEqual([
      {
        payload: { sessionId: 's-1', generation: 1, vcpus: 4, memoryGb: 8 },
        idempotencyKey: 'pod-resize:s-1:1:0',
      },
    ])
  })

  it('refuses a shape above the sandbox provider cap without touching the pod', async () => {
    const { plane, dispatcher, resize } = await setup()

    await expect(resize({ vcpus: 16, memoryGb: 32 })).rejects.toBeInstanceOf(BadRequestException)
    await expect(resize({ vcpus: 16, memoryGb: 32 })).rejects.toThrow(
      '16 vCPU exceeds the 8 vCPU cap for this sandbox provider',
    )
    expect(dispatcher.dispatches).toEqual([])
    expect((await plane.readSession({ sessionId: 's-1' }))?.podSizeGeneration).toBe(0)
  })

  it('refuses a bigger disk on a pod that is not an Agent37 vm', async () => {
    const { dispatcher, resize } = await setup({ sandboxProvider: 'vercel' })

    await expect(resize({ vcpus: 4, memoryGb: 8, diskGb: 30 })).rejects.toThrow(
      'Only an Agent37 pod has a disk that the operator can grow',
    )
    expect(dispatcher.dispatches).toEqual([])
  })

  it('carries the disk and the idle wait when the pod is an Agent37 vm', async () => {
    const { dispatcher, resize } = await setup({ sandboxProvider: 'agent37' })

    await resize({ vcpus: 8, memoryGb: 64, diskGb: 30, whenIdle: true })

    expect(dispatcher.dispatches).toEqual([
      {
        payload: {
          sessionId: 's-1',
          generation: 1,
          vcpus: 8,
          memoryGb: 64,
          diskGb: 30,
          whenIdle: true,
        },
        idempotencyKey: 'pod-resize:s-1:1:0',
      },
    ])
  })
})
