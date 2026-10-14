import type { ThreadId } from '@dltech/atlas-core'
import {
  RotationPort,
  type RotationListener,
  type RotationOutcome,
  type RotationSettle,
  type RotationStage,
} from '@dltech/atlas-harness'

export type RotationRequest = {
  sessionId: string
  threadId: ThreadId
  instructions: string
  settle: RotationSettle
  signal?: AbortSignal | undefined
}

export class ControlledRotation extends RotationPort {
  readonly requests: RotationRequest[] = []
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

  stage(stage: Pick<RotationStage, 'phase'> & { sessionId: string }): void {
    for (const listener of this.listeners) listener({ operationId: 'op', ...stage })
  }

  resolve(outcome: RotationOutcome): void {
    this.finish(outcome)
  }
}
