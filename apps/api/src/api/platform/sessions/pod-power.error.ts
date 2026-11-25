import { ConflictException } from '@nestjs/common'

export const POD_TURN_RUNNING = 'TURN_RUNNING'

export class PodTurnRunningError extends ConflictException {
  constructor(args: { running: readonly string[] }) {
    super({ message: `the pod is busy: ${args.running.join(', ')}`, code: POD_TURN_RUNNING })
  }
}
