import type { ThreadId } from '@dltech/atlas-core'
import {
  RotationPort,
  type RotationListener,
  type RotationOutcome,
  type RotationSettle,
  type RotationStage,
  type RotationStatus,
} from '@dltech/atlas-harness'

export type RotationRequest = {
  sessionId: string
  predecessor: ThreadId
  instructions: string
  settle: RotationSettle
}

export class ControlledRotation extends RotationPort {
  readonly requests: RotationRequest[] = []
  readonly recovers: string[] = []
  private readonly listeners = new Set<RotationListener>()
  private finish: (outcome: RotationOutcome) => void = () => undefined

  subscribe(listener: RotationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  request(args: RotationRequest): Promise<RotationOutcome> {
    this.requests.push(args)
    return new Promise((resolve) => {
      this.finish = resolve
    })
  }

  async status(): Promise<RotationStatus> {
    return { kind: 'idle' }
  }

  async recover(args: { sessionId: string }): Promise<RotationStatus> {
    this.recovers.push(args.sessionId)
    return { kind: 'idle' }
  }

  stage(stage: Pick<RotationStage, 'phase'> & { sessionId: string }): void {
    for (const listener of this.listeners) listener({ operationId: 'op', ...stage })
  }

  resolve(outcome: RotationOutcome): void {
    this.finish(outcome)
  }
}
