import { describe, expect, it } from 'bun:test'

import { toEventId, toThreadId, type EventId } from '@dltech/atlas-core'
import {
  DiagramRepairPort,
  EClientFrame,
  EClientRequest,
  type DiagramRepairOutcome,
} from '@dltech/atlas-harness'

import { createDiagramRepairRequests } from '../diagram-repair-requests'
import type { RequestFrame } from '../request-reply'

const threadId = toThreadId('thr-1')

class ScriptedRepair extends DiagramRepairPort {
  readonly calls: { messageId: EventId; source: string; error: string }[] = []
  constructor(private readonly outcome: DiagramRepairOutcome | Error) {
    super()
  }
  async repair(args: {
    messageId: EventId
    source: string
    error: string
  }): Promise<DiagramRepairOutcome> {
    this.calls.push({ messageId: args.messageId, source: args.source, error: args.error })
    if (this.outcome instanceof Error) throw this.outcome
    return this.outcome
  }
}

const frame = (params: unknown): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'r1',
  op: EClientRequest.RepairDiagram,
  params,
})

const valid = { threadId: 'thr-1', messageId: 'evt-1', source: 'graph TD', error: 'bad' }

describe('diagram repair requests', () => {
  it('answers a repaired diagram from the port', async () => {
    const port = new ScriptedRepair({ kind: 'repaired', repaired: 'fixed' })
    const requests = createDiagramRepairRequests({ threadId, diagramRepair: port })

    expect(await requests.answer(frame(valid))).toMatchObject({
      replyTo: 'r1',
      ok: true,
      data: { kind: 'repaired', repaired: 'fixed' },
    })
    expect(port.calls).toEqual([
      { messageId: toEventId('evt-1'), source: 'graph TD', error: 'bad' },
    ])
  })

  it('answers a failed outcome as data, not a refusal', async () => {
    const requests = createDiagramRepairRequests({
      threadId,
      diagramRepair: new ScriptedRepair({ kind: 'failed', reason: 'unchanged' }),
    })

    expect(await requests.answer(frame(valid))).toMatchObject({
      ok: true,
      data: { kind: 'failed', reason: 'unchanged' },
    })
  })

  it('refuses invalid params', async () => {
    const requests = createDiagramRepairRequests({
      threadId,
      diagramRepair: new ScriptedRepair({ kind: 'failed', reason: 'x' }),
    })

    expect(await requests.answer(frame({ threadId: 'thr-1' }))).toMatchObject({ ok: false })
  })

  it('refuses a foreign thread without calling the port', async () => {
    const port = new ScriptedRepair({ kind: 'repaired', repaired: 'fixed' })
    const requests = createDiagramRepairRequests({ threadId, diagramRepair: port })

    expect(await requests.answer(frame({ ...valid, threadId: 'other' }))).toMatchObject({
      ok: false,
      data: { message: 'this sandbox serves one thread' },
    })
    expect(port.calls).toEqual([])
  })

  it('refuses when the serve has no port', async () => {
    const requests = createDiagramRepairRequests({ threadId, diagramRepair: undefined })

    expect(await requests.answer(frame(valid))).toMatchObject({ ok: false })
  })

  it('refuses with the error message when the port throws', async () => {
    const requests = createDiagramRepairRequests({
      threadId,
      diagramRepair: new ScriptedRepair(new Error('log down')),
    })

    expect(await requests.answer(frame(valid))).toMatchObject({
      ok: false,
      data: { message: 'log down' },
    })
  })
})
