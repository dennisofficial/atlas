import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import {
  ECallStatus,
  ELiveOpFailure,
  type CallResult,
  type ServicesLogOutput,
} from '@dltech/atlas-protocol'
import { POD_OPS, type PodOps } from '../../../agent'
import { PodParkedError } from './pod-parked.error'
import { SessionsService } from './sessions.service'

const LOG_TAIL_BYTES = 64 * 1024

type OkResult = Extract<CallResult, { status: ECallStatus.Ok }>
type LogResult = Extract<OkResult, { op: 'services.log' }>

const decode = (bytes: string): string => Buffer.from(bytes, 'base64').toString('utf8')

@Injectable()
export class ServicesService {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
  ) {}

  private async invoke(args: {
    sessionId: string
    serviceId: string
    offset: number
  }): Promise<LogResult['value']> {
    if (this.ops === null) throw new ServiceUnavailableException('pod access is not running')
    const outcome = await this.ops.invoke({
      sessionId: args.sessionId,
      op: {
        op: 'services.log',
        serviceId: args.serviceId,
        offset: args.offset,
        limit: LOG_TAIL_BYTES,
      },
    })
    if (outcome.state === 'unavailable') {
      if (outcome.reason === ELiveOpFailure.Asleep) throw new PodParkedError()
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'this pod op is not allowed' })
    }
    if (outcome.result.status === ECallStatus.Failed)
      throw new TRPCError({ code: 'BAD_REQUEST', message: outcome.result.error.message })
    return (outcome.result as LogResult).value
  }

  async log(args: {
    userId: string
    sessionId: string
    serviceId: string
  }): Promise<ServicesLogOutput> {
    await this.sessions.requireOwnedSession({ userId: args.userId, sessionId: args.sessionId })
    const head = await this.invoke({ ...args, offset: 0 })
    if (head.totalBytes <= LOG_TAIL_BYTES) return { text: decode(head.bytes), truncated: false }
    const tail = await this.invoke({ ...args, offset: head.totalBytes - LOG_TAIL_BYTES })
    return { text: decode(tail.bytes), truncated: true }
  }
}
