import { describe, expect, it } from 'bun:test'
import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  EClientFrame,
  EClientRequest,
  ERotationPhase,
  RotationBusy,
  RotationPort,
  type RotationListener,
  type RotationOutcome,
  type RotationSettle,
} from '@dltech/atlas-harness'
import { EWireRotationPhase, type RotationStateWire } from '@dltech/atlas-wire'

import { createHistoryAdmission } from '../history-admission'
import type { RequestFrame } from '../request-reply'
import { createRotationRequests } from '../rotation-requests'

const served = toThreadId('rotation-served')
const stranger = toThreadId('rotation-stranger')

class ScriptedRotation extends RotationPort {
  listeners = new Set<RotationListener>()
  requests: { sessionId: string; threadId: ThreadId; instructions: string; settle: RotationSettle }[] = []
  finish: (outcome: RotationOutcome) => void = () => undefined
  busy = false

  async request(args: { sessionId: string; threadId: ThreadId; instructions: string; settle: RotationSettle }) {
    if (this.busy) throw new RotationBusy({ sessionId: args.sessionId })
    this.requests.push(args)
    return new Promise<RotationOutcome>((resolve) => {
      this.finish = resolve
    })
  }
  subscribe(listener: RotationListener) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  stage(phase: ERotationPhase, detail?: string) {
    for (const listener of this.listeners) listener({ sessionId: served, operationId: 'op', phase, detail })
  }
}

const rotateFrame = (params: Record<string, unknown>): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'r1',
  op: EClientRequest.Rotate,
  params,
})

const rig = (args?: { rotation?: ScriptedRotation | null }) => {
  const rotation = args?.rotation === null ? undefined : (args?.rotation ?? new ScriptedRotation())
  const admission = createHistoryAdmission({ threadId: () => served, intake: null, unavailable: () => false })
  const broadcasts: RotationStateWire[] = []
  let changes = 0
  const requests = createRotationRequests({
    threadId: served,
    rotation,
    driver: {
      holdForRotation: admission.holdForRotation,
      beginRotation: () => ({ pause: () => undefined, waitSettled: async () => null }),
    },
    broadcast: (state) => void broadcasts.push(state),
    changed: () => void (changes += 1),
    log: () => undefined,
  })
  return { rotation, requests, admission, broadcasts, changes: () => changes }
}

const params = { threadId: served, operationId: 'op-1', instructions: 'keep going' }

describe('rotation requests', () => {
  it('answers started on the first stage and passes the thread, settle and instructions through', async () => {
    const { rotation, requests, admission } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    expect(await reply).toMatchObject({ ok: true, data: { type: 'started' } })
    expect(rotation!.requests[0]).toMatchObject({ sessionId: served, threadId: served, instructions: 'keep going' })
    expect(admission.held()).toBe(true)
    rotation!.finish({ kind: 'failed', reason: 'x' })
    await requests.whenSettled()
  })

  it('refuses when the serve has no rotation port', async () => {
    const { requests, admission } = rig({ rotation: null })
    expect(await requests.answer(rotateFrame(params))).toMatchObject({
      data: { type: 'refused', reason: 'this serve cannot rotate' },
    })
    expect(admission.held()).toBe(false)
  })

  it('refuses a thread the serve does not serve', async () => {
    const { rotation, requests, admission } = rig()
    const reply = await requests.answer(rotateFrame({ ...params, threadId: stranger }))
    expect(reply).toMatchObject({ data: { type: 'refused', reason: 'this sandbox serves one thread' } })
    expect(rotation!.requests).toHaveLength(0)
    expect(admission.held()).toBe(false)
  })

  it('maps stages to wire phases and ends with a done frame carrying the watermark, then releases the hold', async () => {
    const { rotation, requests, admission, broadcasts, changes } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    for (const phase of [
      ERotationPhase.Settling,
      ERotationPhase.Summarising,
      ERotationPhase.Compacting,
      ERotationPhase.Done,
      ERotationPhase.Failed,
    ])
      rotation!.stage(phase)
    await reply
    rotation!.finish({
      kind: 'rotated',
      sessionId: served,
      operationId: 'op',
      threadId: served,
      watermarkSeq: 3,
      replaced: 3,
    })
    await requests.whenSettled()
    expect(broadcasts).toEqual([
      { phase: EWireRotationPhase.Settling },
      { phase: EWireRotationPhase.Summarising },
      { phase: EWireRotationPhase.Compacting },
      { phase: EWireRotationPhase.Done, watermarkSeq: 3 },
    ])
    expect(changes()).toBe(1)
    expect(admission.held()).toBe(false)
    expect(requests.current()).toBeUndefined()
  })

  it('broadcasts a failed terminal with the reason, leaves history alone, and releases the hold', async () => {
    const { rotation, requests, admission, broadcasts, changes } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    await reply
    rotation!.finish({ kind: 'failed', reason: 'summary came back empty' })
    await requests.whenSettled()
    expect(broadcasts.at(-1)).toEqual({ phase: EWireRotationPhase.Failed, reason: 'summary came back empty' })
    expect(changes()).toBe(0)
    expect(admission.held()).toBe(false)
    expect(() => admission.hold()()).not.toThrow()
  })

  it('answers refused when the port refuses before any stage', async () => {
    const { rotation, requests, admission, broadcasts } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.finish({ kind: 'refused', reason: 'nothing to rotate' })
    expect(await reply).toMatchObject({ data: { type: 'refused', reason: 'nothing to rotate' } })
    await requests.whenSettled()
    expect(broadcasts).toEqual([])
    expect(admission.held()).toBe(false)
  })

  it('refuses on RotationBusy and releases the hold', async () => {
    const rotation = new ScriptedRotation()
    rotation.busy = true
    const { requests, admission, broadcasts } = rig({ rotation })
    expect(await requests.answer(rotateFrame(params))).toMatchObject({
      data: { type: 'refused', reason: 'a rotation is already underway' },
    })
    await requests.whenSettled()
    expect(admission.held()).toBe(false)
    expect(broadcasts).toEqual([])
  })

  it('refuses while another hold owns the session', async () => {
    const { requests, admission } = rig()
    const release = admission.hold()
    expect(await requests.answer(rotateFrame(params))).toMatchObject({ data: { type: 'refused' } })
    release()
  })

  it('refuses malformed params', async () => {
    const { requests } = rig()
    expect(await requests.answer(rotateFrame({}))).toMatchObject({ ok: false })
  })
})
