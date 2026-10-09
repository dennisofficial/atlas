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
const successor = toThreadId('rotation-successor')
const stranger = toThreadId('rotation-stranger')

class ScriptedRotation extends RotationPort {
  listeners = new Set<RotationListener>()
  requests: { sessionId: string; predecessor: ThreadId; instructions: string; settle: RotationSettle }[] = []
  finish: (outcome: RotationOutcome) => void = () => undefined
  busy = false

  async request(args: { sessionId: string; predecessor: ThreadId; instructions: string; settle: RotationSettle }) {
    if (this.busy) throw new RotationBusy({ sessionId: args.sessionId })
    this.requests.push(args)
    return new Promise<RotationOutcome>((resolve) => {
      this.finish = resolve
    })
  }
  async status() {
    return { kind: 'idle' as const }
  }
  async recover() {
    return { kind: 'idle' as const }
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

const rig = (args?: { rotation?: ScriptedRotation | null; related?: Set<string>; activeMain?: ThreadId }) => {
  const rotation = args?.rotation === null ? undefined : (args?.rotation ?? new ScriptedRotation())
  const admission = createHistoryAdmission({ threadId: () => served, intake: null, unavailable: () => false })
  const broadcasts: RotationStateWire[] = []
  const requests = createRotationRequests({
    threadId: served,
    rotation,
    authority: {
      mainGenerationOf: async ({ threadId }) => (args?.related?.has(threadId) === true ? 0 : undefined),
      activeMainOf: async () => args?.activeMain,
    },
    driver: {
      holdForRotation: admission.holdForRotation,
      beginRotation: () => ({ pause: () => undefined, waitSettled: async () => null }),
      followActiveMain: () => true,
    },
    broadcast: (state) => void broadcasts.push(state),
    log: () => undefined,
  })
  return { rotation, requests, admission, broadcasts }
}

const params = { threadId: served, operationId: 'op-1', instructions: 'keep going' }

describe('rotation requests', () => {
  it('answers started on the first stage and passes the settle and instructions through', async () => {
    const { rotation, requests, admission } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    expect(await reply).toMatchObject({ ok: true, data: { type: 'started' } })
    expect(rotation!.requests[0]).toMatchObject({ sessionId: served, predecessor: served, instructions: 'keep going' })
    expect(admission.held()).toBe(true)
    rotation!.finish({ kind: 'failed', sessionId: served, operationId: 'op', reason: 'x' })
    await requests.whenSettled()
  })

  it('refuses when the serve has no rotation port', async () => {
    const { requests, admission } = rig({ rotation: null })
    expect(await requests.answer(rotateFrame(params))).toMatchObject({
      data: { type: 'refused', reason: 'this serve cannot rotate' },
    })
    expect(admission.held()).toBe(false)
  })

  it('refuses a thread that is neither served nor a session main', async () => {
    const { rotation, requests, admission } = rig()
    const reply = await requests.answer(rotateFrame({ ...params, threadId: stranger }))
    expect(reply).toMatchObject({ data: { type: 'refused' } })
    expect(rotation!.requests).toHaveLength(0)
    expect(admission.held()).toBe(false)
  })

  it('accepts a related session main by authority', async () => {
    const { rotation, requests } = rig({ related: new Set([successor]) })
    const reply = requests.answer(rotateFrame({ ...params, threadId: successor }))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    expect(await reply).toMatchObject({ data: { type: 'started' } })
    rotation!.finish({ kind: 'aborted', sessionId: served, operationId: 'op', reason: 'x' })
    await requests.whenSettled()
  })

  it('maps stages to wire phases and ends with the successor on commit, then releases the hold', async () => {
    const { rotation, requests, admission, broadcasts } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    for (const phase of [
      ERotationPhase.Settling,
      ERotationPhase.Summarising,
      ERotationPhase.Preparing,
      ERotationPhase.Committing,
      ERotationPhase.Activating,
      ERotationPhase.Committed,
    ])
      rotation!.stage(phase)
    await reply
    rotation!.finish({
      kind: 'committed',
      sessionId: served,
      operationId: 'op',
      predecessor: served,
      successor,
      handoffPath: '/h.md',
      watermarkSeq: 3,
    })
    await requests.whenSettled()
    expect(broadcasts.map((state) => state.phase)).toEqual([
      EWireRotationPhase.Settling,
      EWireRotationPhase.Preparing,
      EWireRotationPhase.Preparing,
      EWireRotationPhase.Writing,
      EWireRotationPhase.Activating,
      EWireRotationPhase.Activating,
    ])
    expect(broadcasts.at(-1)).toEqual({ phase: EWireRotationPhase.Activating, successor })
    expect(admission.held()).toBe(false)
    expect(requests.current()).toBeUndefined()
  })

  it('broadcasts a failed terminal with the reason and releases the hold', async () => {
    const { rotation, requests, admission, broadcasts } = rig()
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    await reply
    rotation!.finish({ kind: 'failed', sessionId: served, operationId: 'op', reason: 'summary came back empty' })
    await requests.whenSettled()
    expect(broadcasts.at(-1)).toEqual({ phase: EWireRotationPhase.Failed, reason: 'summary came back empty' })
    expect(admission.held()).toBe(false)
    expect(() => admission.hold()()).not.toThrow()
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

  it('drives the session’s active main, not the boot thread, so a rotate after a wake from a rotated session does not refuse', async () => {
    // The woken sandbox boots for the session’s original thread while the session meta’s active
    // main is the committed successor of a pre-park rotation. The drive must follow the active
    // main — passing the boot thread as predecessor is what the orchestrator fence refused with
    // "the thread is not the session’s active main".
    const { rotation, requests } = rig({ activeMain: successor })
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    expect(await reply).toMatchObject({ data: { type: 'started' } })
    expect(rotation!.requests[0]).toMatchObject({ sessionId: served, predecessor: successor })
    rotation!.finish({ kind: 'failed', sessionId: served, operationId: 'op', reason: 'x' })
    await requests.whenSettled()
  })

  it('drives the served thread while it is still the active main', async () => {
    const { rotation, requests } = rig({ activeMain: served })
    const reply = requests.answer(rotateFrame(params))
    await Promise.resolve()
    await Promise.resolve()
    rotation!.stage(ERotationPhase.Settling)
    expect(await reply).toMatchObject({ data: { type: 'started' } })
    expect(rotation!.requests[0]).toMatchObject({ sessionId: served, predecessor: served })
    rotation!.finish({ kind: 'failed', sessionId: served, operationId: 'op', reason: 'x' })
    await requests.whenSettled()
  })
})
