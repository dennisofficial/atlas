import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, toRunId } from '@dltech/atlas-core'
import { EDaemonCapability } from '@dltech/atlas-protocol'

import { oweChildStoppedCalls, payStopDebts, watchStopDebts } from '../stop-debts'
import {
  CAN,
  CHILD,
  SCOPE_CHILD,
  SCOPE_OPEN,
  THREAD,
  appendTo,
  callsOf,
  factKeysOf,
  gateOf,
  openCall,
  openThread,
  owedFact,
  portsOf,
  recordOf,
  until,
} from './stop-debt-rig'

describe('stop debts of a stopped turn', () => {
  it('sends cancel-scope for each scope still owed', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('sends nothing when the daemon cannot cancel a scope', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf([EDaemonCapability.ExecDeadline])

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([])
  })

  it('retires the debt when the daemon confirms the scope, so the next holder sends nothing', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent, confirm } = callsOf(CAN)
    const ports = portsOf({ record, calls })
    watchStopDebts(ports)

    payStopDebts(ports)
    confirm([SCOPE_OPEN])
    await until(() => factKeysOf(record).includes(`stop-paid:${SCOPE_OPEN}`))
    payStopDebts(ports)

    expect(record.appends.flat().map((draft) => draft.key)).toEqual([`stop-paid:${SCOPE_OPEN}`])
    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('still pays the debt after a summary hid the events around it', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({ plane, epoch, threadId: THREAD, bodies: [owedFact(SCOPE_OPEN)] })
    await appendTo({
      plane,
      epoch,
      threadId: THREAD,
      bodies: [
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 2,
          anchor: ECompactionAnchor.Prefix,
          summary: 'the stopped work',
        },
      ],
    })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([SCOPE_OPEN])
  })

  it('drops a debt that a later dispatch of the same call id re-used', async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      threadId: THREAD,
      bodies: [owedFact(SCOPE_OPEN), ...openCall('call-open')],
    })
    const record = await recordOf({ plane, epoch, threadId: THREAD })
    const { calls, sent } = callsOf(CAN)

    payStopDebts(portsOf({ record, calls }))

    expect(sent).toEqual([])
  })
})

describe('stop debts of a stopped child run', () => {
  it("owes the child's open call scopes in the parent record", async () => {
    const { plane, epoch } = await openThread()
    await appendTo({
      plane,
      epoch,
      threadId: CHILD,
      bodies: openCall('call-child'),
    })
    const child = await recordOf({ plane, epoch, threadId: CHILD })
    const parent = await recordOf({ plane, epoch, threadId: THREAD })

    await oweChildStoppedCalls({
      child,
      parent,
      runId: () => toRunId('run-2'),
    })

    expect(parent.appends.flat().map((draft) => draft.key)).toEqual([`stop-owed:${SCOPE_CHILD}`])
    const { calls, sent } = callsOf(CAN)
    payStopDebts(portsOf({ record: parent, calls }))
    expect(sent).toEqual([SCOPE_CHILD])
  })

  it('owes a child dispatch that was still committing when the child stopped', async () => {
    const { plane, epoch } = await openThread()
    const gate = gateOf()
    const child = await recordOf({ plane, epoch, threadId: CHILD, gate })
    const parent = await recordOf({ plane, epoch, threadId: THREAD })
    gate.hold()
    const appending = child.enqueue(openCall('call-child'))
    await until(() => gate.reached())
    const owed = oweChildStoppedCalls({ child, parent, runId: () => toRunId('run-2') })
    gate.release()
    await Promise.all([appending, owed])

    expect(parent.appends.flat().map((draft) => draft.key)).toEqual([`stop-owed:${SCOPE_CHILD}`])
  })
})
