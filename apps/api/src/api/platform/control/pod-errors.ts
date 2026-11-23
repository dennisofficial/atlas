import { BadRequestException, PreconditionFailedException } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import {
  ECallStatus,
  EPodNotReady,
  ELiveOpFailure,
  POD_PARKED_MESSAGE,
} from '@dltech/atlas-protocol'
import type { PodCallOutcome } from '@dltech/atlas-host'

const POD_OP_NOT_ALLOWED = 'this pod op is not allowed'

export type OkOutcome = Extract<PodCallOutcome, { state: 'ok' }>
export type FailedResult = Extract<OkOutcome['result'], { status: ECallStatus.Failed }>

export class PodNotReadyError extends TRPCError {
  constructor() {
    super({
      code: 'PRECONDITION_FAILED',
      message: POD_PARKED_MESSAGE,
      cause: new PreconditionFailedException({
        code: EPodNotReady.NotReady,
        message: POD_PARKED_MESSAGE,
      }),
    })
  }
}

export const reachablePodOutcome = (outcome: PodCallOutcome): OkOutcome => {
  if (outcome.state === 'ok') return outcome
  if (outcome.reason === ELiveOpFailure.Asleep) throw new PodNotReadyError()
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: POD_OP_NOT_ALLOWED })
}

export const podFailureError = (result: FailedResult): TRPCError =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: result.error.message,
    cause: new BadRequestException({
      message: result.error.message,
      podFailure: result.error.code,
    }),
  })
