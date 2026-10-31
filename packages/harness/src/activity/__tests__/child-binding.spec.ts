import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EStepEnd } from '@dltech/atlas-wire'

import { createDeltaChannel } from '../../channel/delta-channel'
import { bindChildThreadActivity, type ActivityReport } from '../index'

const threadId = toThreadId('child')
const arrange = () => {
  const channel = createDeltaChannel()
  const reports: ActivityReport[] = []
  const binding = bindChildThreadActivity({
    threadId,
    channel,
    report: (state) => reports.push(state),
  })
  return { binding, channel, reports, publisher: channel.publisherFor({ threadId }) }
}

describe('child thread activity', () => {
  it.each([
    { end: EStepEnd.Failed, lastOutcome: 'failed' },
    { end: EStepEnd.Interrupted, lastOutcome: 'stopped' },
    { end: EStepEnd.Completed, lastOutcome: 'completed' },
  ])('maps $end at the child turn end', ({ end, lastOutcome }) => {
    const h = arrange()
    h.publisher.turnWorking({ working: true })
    h.publisher.onChunk({ type: 'text-delta', id: 'text-1', text: 'Hello' })
    h.publisher.close({ end })
    expect(h.reports).toHaveLength(1)
    h.publisher.turnWorking({ working: false })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: null, lastOutcome })
    h.publisher.turnWorking({ working: true })
    h.publisher.turnWorking({ working: false })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: null })
  })

  it.each([EStepEnd.Retried, EStepEnd.Detached])(
    'ignores %s without inventing a terminal outcome',
    (end) => {
      const h = arrange()
      h.publisher.turnWorking({ working: true })
      h.publisher.onChunk({ type: 'text-delta', id: 'text-1', text: 'Hello' })
      h.publisher.close({ end })
      h.publisher.turnWorking({ working: false })
      expect(h.reports).toEqual([
        { working: true, awaiting: null },
        { working: false, awaiting: null },
      ])
    },
  )

  it('filters root and sibling signals and detaches child input and lifecycle', () => {
    const h = arrange()
    h.channel.publisherFor({ threadId: toThreadId('root') }).turnWorking({ working: true })
    h.channel.publisherFor({ threadId: toThreadId('sibling') }).turnWorking({ working: true })
    expect(h.reports).toEqual([])
    h.publisher.operatorInput({ open: { requestId: 'input', description: 'Code', path: '/code' } })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: 'input' })
    h.publisher.operatorInput({ open: null })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: null })
    h.binding.detach()
    h.publisher.turnWorking({ working: true })
    h.publisher.operatorInput({ open: { requestId: 'late', description: 'Code', path: '/code' } })
    expect(h.reports).toHaveLength(2)
  })

  it('reports working before completion and assigns the step outcome without emitting', () => {
    const h = arrange()
    h.publisher.turnWorking({ working: true })
    h.publisher.onChunk({ type: 'text-delta', id: 'text-1', text: 'Hello' })
    h.publisher.close({ end: EStepEnd.Completed })
    expect(h.reports).toEqual([{ working: true, awaiting: null }])
    h.publisher.turnWorking({ working: false })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: null, lastOutcome: 'completed' })
  })
})
