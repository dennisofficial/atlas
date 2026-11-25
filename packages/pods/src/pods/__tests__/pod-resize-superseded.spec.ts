import { describe, expect, it } from 'bun:test'
import { EPodResizeOutcome } from '@dltech/atlas-jobs/pod-resize'

import type { PodResizeOutcome } from '../../sandbox/sandbox-provider'
import { runPodResize, type PodResizeDeps } from '../pod-resize-run'
import { depsOf, payload, sessionOf } from './pod-resize-fixture'

const supersededDuring = (args: {
  resize: () => Promise<PodResizeOutcome>
}): Partial<PodResizeDeps> => {
  let generation = 2
  return {
    session: async () => sessionOf({ podSizeGeneration: generation }),
    resize: async () => {
      generation = 3
      return args.resize()
    },
  }
}

describe('runPodResize superseded while agent37 resizes', () => {
  it('posts no applied notice and wakes nothing for the size a newer resize replaced', async () => {
    const { deps, notices, wakes, started, applied } = depsOf(
      supersededDuring({ resize: async () => 'restarted' }),
    )

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(started).toHaveLength(0)
    expect(notices).toEqual([])
    expect(wakes).toEqual([])
    expect(applied).toEqual([{ sessionId: 'session-a', vcpus: 4, memoryGb: 16, generation: 2 }])
  })

  it('posts no failure notice for a superseded size and does not fail the run', async () => {
    const { deps, notices } = depsOf(
      supersededDuring({
        resize: async () => {
          throw new Error('sandbox refused the resize')
        },
      }),
    )

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(notices).toEqual([])
  })

  it('posts no failure notice when a superseded size found no sandbox', async () => {
    const { deps, notices } = depsOf(supersededDuring({ resize: async () => 'absent' }))

    expect(await runPodResize({ payload, deps })).toEqual({
      outcome: EPodResizeOutcome.Superseded,
    })
    expect(notices).toEqual([])
  })

  it('still posts the applied notice of the newest generation', async () => {
    const { deps, notices } = depsOf()

    expect(await runPodResize({ payload, deps })).toEqual({ outcome: EPodResizeOutcome.Applied })
    expect(notices).toEqual([
      {
        sessionId: 'session-a',
        notice: { vcpus: 4, memoryGb: 16, generation: 2, outcome: 'applied' },
      },
    ])
  })
})
