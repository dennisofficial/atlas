import { TRPCError } from '@trpc/server'
import { POD_PARKED_MESSAGE } from '@dltech/atlas-protocol'

export class PodParkedError extends TRPCError {
  constructor() {
    super({ code: 'PRECONDITION_FAILED', message: POD_PARKED_MESSAGE })
  }
}
