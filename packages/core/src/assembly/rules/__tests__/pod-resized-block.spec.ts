import { describe, expect, it } from 'bun:test'

import { EPodResizeNotice } from '../../../pod/pod-resize-notice'
import { podResizedBlock } from '../pod-resized-block'

const event = (over: Partial<Parameters<typeof podResizedBlock>[0]> = {}) =>
  ({
    id: 'evt_1',
    seq: 4,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-11-24T12:00:00.000Z',
    type: 'pod-resized',
    vcpus: 16,
    memoryGb: 64,
    generation: 3,
    outcome: EPodResizeNotice.Applied,
    ...over,
  }) as Parameters<typeof podResizedBlock>[0]

describe('a pod-resized event', () => {
  it('tells the agent the new size as a system notice', () => {
    const text = podResizedBlock(event())

    expect(text).toContain('kind="pod-resized"')
    expect(text).toContain('The pod was resized to 16 vCPU / 64 GB of memory.')
  })

  it('says the pod keeps its previous size when the resize failed', () => {
    const text = podResizedBlock(
      event({ outcome: EPodResizeNotice.Failed, error: 'sandbox refused the resize' }),
    )

    expect(text).toContain(
      'Resizing the pod to 16 vCPU / 64 GB failed: sandbox refused the resize. The pod keeps its previous size.',
    )
  })
})
