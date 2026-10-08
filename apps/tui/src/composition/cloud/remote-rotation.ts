import { randomUUID } from 'node:crypto'

import type { ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  RotationPort,
  type CloudChannel,
  type RotationListener,
  type RotationOutcome,
  type RotationStatus,
} from '@dltech/atlas-harness'
import {
  EWireRotationPhase,
  rotateReplySchema,
  rotateRequestParamsSchema,
  type RotationStateWire,
} from '@dltech/atlas-wire'

import { stagePhaseOfWire } from '../rotation-phase'

type RotationChannel = Pick<CloudChannel, 'request' | 'subscribe' | 'threadId'>

export class RemoteRotation extends RotationPort {
  private readonly channel: RotationChannel
  private latest: RotationStateWire | undefined

  constructor(args: { channel: RotationChannel }) {
    super()
    this.channel = args.channel
  }

  subscribe(listener: RotationListener): () => void {
    return this.watch((state) =>
      listener({
        sessionId: this.channel.threadId,
        operationId: '',
        phase: stagePhaseOfWire(state.phase),
        detail: state.reason ?? undefined,
      }),
    )
  }

  async request(args: {
    sessionId: string
    predecessor: ThreadId
    instructions: string
  }): Promise<RotationOutcome> {
    const { sessionId, predecessor } = args
    const operationId = randomUUID()
    let stop = (): void => undefined
    const terminal = new Promise<RotationOutcome>((resolve) => {
      stop = this.watch((state) => {
        if (state.successor !== undefined) {
          resolve({
            kind: 'committed',
            sessionId,
            operationId,
            predecessor,
            successor: state.successor,
            handoffPath: '',
            watermarkSeq: 0,
          })
          return
        }
        if (state.phase === EWireRotationPhase.Failed) {
          resolve({ kind: 'failed', sessionId, operationId, reason: state.reason ?? 'the rotation failed' })
        }
      })
    })

    try {
      const reply = rotateReplySchema.parse(
        await this.channel.request({
          op: EClientRequest.Rotate,
          params: rotateRequestParamsSchema.parse({
            threadId: predecessor,
            operationId,
            ...(args.instructions === '' ? {} : { instructions: args.instructions }),
          }),
        }),
      )
      if (reply.type === 'refused') return { kind: 'failed', sessionId, operationId, reason: reply.reason }

      return await terminal
    } finally {
      stop()
    }
  }

  async status(args: { sessionId: string }): Promise<RotationStatus> {
    const held = this.latest
    if (held === undefined || held.phase === EWireRotationPhase.Failed || held.successor !== undefined) {
      return { kind: 'idle' }
    }

    return {
      kind: 'active',
      sessionId: args.sessionId,
      operationId: '',
      phase: stagePhaseOfWire(held.phase),
      predecessor: this.channel.threadId,
      successor: undefined,
      watermarkSeq: undefined,
    }
  }

  async recover(args: { sessionId: string }): Promise<RotationStatus> {
    return this.status(args)
  }

  private watch(onState: (state: RotationStateWire) => void): () => void {
    return this.channel.subscribe({
      threadId: this.channel.threadId,
      listener: (signal) => {
        if (signal.type !== 'rotation-changed') return

        this.latest = signal.rotation
        onState(signal.rotation)
      },
    })
  }
}
