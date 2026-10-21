import { afterEach, describe, expect, it } from 'vitest'

import { EToolEffect, toCallId, type EventDraft } from '@dltech/atlas-core'

import { settleCrashedCalls } from '../dispatch-recovery'
import { discardOpened, openLog, branchWithCalls } from './settle-pending-fixture'

afterEach(discardOpened)

const marker = (args: { callId: string; name: string }): EventDraft => ({
  type: 'tool-dispatched',
  callId: toCallId(args.callId),
  name: args.name,
})

describe('settleCrashedCalls', () => {
  it('writes nothing when no call is pending', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({ harness, calls: [] })

    const crashed = await settleCrashedCalls({
      log: harness.log,
      ids: harness.ids,
      threadId,
      effectOf: () => EToolEffect.Write,
    })

    expect(crashed).toEqual([])
    expect((await harness.log.read({ threadId })).map((event) => event.type)).toEqual([
      'user-said',
      'assistant-said',
    ])
  })

  it('leaves a marked Read call pending for the normal redispatch', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [{ callId: 'call-1', name: 'read' }],
    })
    await harness.log.append({
      threadId,
      runId: harness.ids.nextRunId(),
      drafts: [marker({ callId: 'call-1', name: 'read' })],
    })

    await settleCrashedCalls({
      log: harness.log,
      ids: harness.ids,
      threadId,
      effectOf: () => EToolEffect.Read,
    })

    const types = (await harness.log.read({ threadId })).map((event) => event.type)
    expect(types.filter((type) => type === 'tool-result')).toEqual([])
  })

  it('synthesizes an interrupted result for a marked Write call', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [{ callId: 'call-1', name: 'write_file' }],
    })
    await harness.log.append({
      threadId,
      runId: harness.ids.nextRunId(),
      drafts: [marker({ callId: 'call-1', name: 'write_file' })],
    })

    await settleCrashedCalls({
      log: harness.log,
      ids: harness.ids,
      threadId,
      effectOf: (name) => (name === 'write_file' ? EToolEffect.Write : EToolEffect.Read),
    })

    const results = (await harness.log.read({ threadId })).filter(
      (event) => event.type === 'tool-result',
    )
    expect(results).toHaveLength(1)
    const result = results[0]
    if (result?.type !== 'tool-result') return
    expect(result.callId).toBe(toCallId('call-1'))
    expect(result.interrupted).toBe(true)
    expect(result.error?.message).toContain('process restart')
    expect(result.error?.message).toContain('write_file')
  })

  it('treats an unknown tool as not replay-safe and settles it', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [{ callId: 'call-1', name: 'vanished_tool' }],
    })
    await harness.log.append({
      threadId,
      runId: harness.ids.nextRunId(),
      drafts: [marker({ callId: 'call-1', name: 'vanished_tool' })],
    })

    await settleCrashedCalls({
      log: harness.log,
      ids: harness.ids,
      threadId,
      effectOf: () => undefined,
    })

    const results = (await harness.log.read({ threadId })).filter(
      (event) => event.type === 'tool-result',
    )
    expect(results).toHaveLength(1)
  })

  it('settles only the unrecoverable calls in a mixed batch', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [
        { callId: 'call-read', name: 'read', ordinal: 0 },
        { callId: 'call-write', name: 'write_file', ordinal: 1 },
      ],
    })
    await harness.log.append({
      threadId,
      runId: harness.ids.nextRunId(),
      drafts: [
        marker({ callId: 'call-read', name: 'read' }),
        marker({ callId: 'call-write', name: 'write_file' }),
      ],
    })

    await settleCrashedCalls({
      log: harness.log,
      ids: harness.ids,
      threadId,
      effectOf: (name) => (name === 'write_file' ? EToolEffect.Write : EToolEffect.Read),
    })

    const results = (await harness.log.read({ threadId })).filter(
      (event) => event.type === 'tool-result',
    )
    expect(results.map((event) => (event.type === 'tool-result' ? event.callId : ''))).toEqual([
      toCallId('call-write'),
    ])
  })

  it('leaves an unmarked pending call alone', async () => {
    const harness = await openLog()
    const { threadId } = await branchWithCalls({
      harness,
      calls: [{ callId: 'call-1', name: 'write_file' }],
    })

    await settleCrashedCalls({
      log: harness.log,
      ids: harness.ids,
      threadId,
      effectOf: () => EToolEffect.Write,
    })

    const results = (await harness.log.read({ threadId })).filter(
      (event) => event.type === 'tool-result',
    )
    expect(results).toEqual([])
  })
})
