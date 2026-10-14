import { randomUUID } from 'node:crypto'

import type { ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  RotationPort,
  type CloudChannel,
  type RotationListener,
  type RotationOutcome,
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
    threadId: ThreadId
    instructions: string
    signal?: AbortSignal | undefined
  }): Promise<RotationOutcome> {
    const { sessionId, threadId } = args
    const operationId = randomUUID()
    let stop = (): void => undefined
    const terminal = new Promise<RotationOutcome>((resolve) => {
      stop = this.watch((state) => {
        if (state.phase === EWireRotationPhase.Done) {
          resolve({
            kind: 'rotated',
            sessionId,
            operationId,
            threadId,
            watermarkSeq: state.watermarkSeq ?? 0,
            replaced: 0,
          })
          return
        }
        if (state.phase === EWireRotationPhase.Failed) {
          resolve({ kind: 'failed', reason: state.reason ?? 'the rotation failed' })
        }
      })
    })

    try {
      const reply = rotateReplySchema.parse(
        await this.channel.request({
          op: EClientRequest.Rotate,
          params: rotateRequestParamsSchema.parse({
            threadId,
            operationId,
            ...(args.instructions === '' ? {} : { instructions: args.instructions }),
          }),
        }),
      )
      if (reply.type === 'refused') return { kind: 'refused', reason: reply.reason }

      return await terminal
    } finally {
      stop()
    }
  }

  private watch(onState: (state: RotationStateWire) => void): () => void {
    return this.channel.subscribe({
      threadId: this.channel.threadId,
      listener: (signal) => {
        if (signal.type !== 'rotation-changed') return

        onState(signal.rotation)
      },
    })
  }
}
