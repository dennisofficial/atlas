import type { ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  ERotationPhase,
  RotationBusy,
  type RotationOutcome,
  type RotationPort,
  type RotationStage,
} from '@dltech/atlas-harness'
import {
  EWireRotationPhase,
  rotateRequestParamsSchema,
  type RotateReply,
  type RotationStateWire,
} from '@dltech/atlas-wire'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeSessionAuthority } from './serve-app'
import type { ServeTurnDriver } from './turn-driver'

export const isRotationOp = (op: EClientRequest): boolean => op === EClientRequest.Rotate

const BUSY_REASON = 'a rotation is already underway'

const wirePhaseOf = (phase: ERotationPhase): EWireRotationPhase | undefined => {
  switch (phase) {
    case ERotationPhase.Settling:
      return EWireRotationPhase.Settling
    case ERotationPhase.Summarising:
    case ERotationPhase.Preparing:
      return EWireRotationPhase.Preparing
    case ERotationPhase.Committing:
      return EWireRotationPhase.Writing
    case ERotationPhase.Activating:
      return EWireRotationPhase.Activating
    case ERotationPhase.Failed:
    case ERotationPhase.Aborted:
      return EWireRotationPhase.Failed
    default:
      return undefined
  }
}

const terminalOf = (outcome: RotationOutcome): RotationStateWire =>
  outcome.kind === 'committed'
    ? { phase: EWireRotationPhase.Activating, successor: outcome.successor }
    : { phase: EWireRotationPhase.Failed, reason: outcome.reason }

const reasonOf = (error: unknown): string =>
  error instanceof RotationBusy
    ? BUSY_REASON
    : error instanceof Error
      ? error.message
      : 'the rotation failed for a reason it did not name'

export function createRotationRequests(args: {
  threadId: ThreadId
  rotation: RotationPort | undefined
  authority: ServeSessionAuthority | undefined
  driver: Pick<ServeTurnDriver, 'holdForRotation' | 'beginRotation'>
  broadcast: (rotation: RotationStateWire) => void
  log: ServeLog
}) {
  let current: RotationStateWire | undefined
  let finished: Promise<void> | undefined

  const reply = (frame: RequestFrame, data: RotateReply): ReplyFrame => answeredRequest({ replyTo: frame.id, data })
  const refused = (frame: RequestFrame, reason: string): ReplyFrame => reply(frame, { type: 'refused', reason })

  const publish = (rotation: RotationStateWire): void => {
    current = rotation
    args.broadcast(rotation)
  }

  const drive = (driving: {
    rotation: RotationPort
    instructions: string
    release: () => void
  }): { verdict: Promise<RotateReply>; finished: Promise<void> } => {
    let began = false
    let decide: (verdict: RotateReply) => void = () => undefined
    const verdict = new Promise<RotateReply>((resolve) => {
      decide = resolve
    })

    const unsubscribe = driving.rotation.subscribe((stage: RotationStage) => {
      if (stage.sessionId !== args.threadId) return
      const phase = wirePhaseOf(stage.phase)
      if (phase === undefined) return
      began = true
      decide({ type: 'started' })
      publish({ phase, ...(stage.detail === undefined ? {} : { reason: stage.detail }) })
    })

    const settle = async (): Promise<void> => {
      try {
        const outcome = await driving.rotation.request({
          sessionId: args.threadId,
          predecessor: args.threadId,
          instructions: driving.instructions,
          settle: args.driver.beginRotation(),
        })
        if (!began && outcome.kind !== 'committed') {
          decide({ type: 'refused', reason: outcome.reason })
          return
        }
        decide({ type: 'started' })
        if (outcome.kind !== 'committed') args.log({ event: EServeEvent.RotationFailed, reason: outcome.reason })
        publish(terminalOf(outcome))
      } catch (error) {
        const reason = reasonOf(error)
        decide({ type: 'refused', reason })
        if (began) {
          args.log({ event: EServeEvent.RotationFailed, reason })
          publish({ phase: EWireRotationPhase.Failed, reason })
        }
      } finally {
        unsubscribe()
        current = undefined
        driving.release()
      }
    }
    return { verdict, finished: settle() }
  }

  const answer = async (frame: RequestFrame): Promise<ReplyFrame> => {
    const parsed = rotateRequestParamsSchema.safeParse(frame.params)
    if (!parsed.success) return refusedRequest({ replyTo: frame.id, message: 'invalid rotate request' })
    if (args.rotation === undefined) return refused(frame, 'this serve cannot rotate')
    const params = parsed.data
    if (params.threadId !== args.threadId) {
      const generation = await args.authority?.mainGenerationOf({ threadId: params.threadId })
      if (generation === undefined) return refused(frame, 'this sandbox serves one thread')
    }

    let release: () => void
    try {
      release = args.driver.holdForRotation()
    } catch (error) {
      return refused(frame, reasonOf(error))
    }

    const driving = drive({ rotation: args.rotation, instructions: params.instructions ?? '', release })
    finished = driving.finished
    void driving.finished.then(() => {
      if (finished === driving.finished) finished = undefined
    })
    return reply(frame, await driving.verdict)
  }

  return {
    answer,
    active: () => finished !== undefined,
    current: (): RotationStateWire | undefined => current,
    whenSettled: async (): Promise<void> => {
      await finished
    },
  }
}
