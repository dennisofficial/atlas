import { Inject, Optional, ServiceUnavailableException } from '@nestjs/common'
import { SESSION_STREAM, type SessionStream } from '../../../agent'
import type { StreamServerMessage } from '@dltech/atlas-protocol'
import {
  type SessionStreamFollowInput,
  sessionStreamFollowInputSchema,
  sessionStreamOutputSchema,
} from '@dltech/atlas-wire'
import {
  Ctx,
  Input,
  Options,
  type ProcedureOptions,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { DrainStateService } from '../../platform/health/drain-state.service'

export const HOST_ABSENT = 'the agent host is not mounted in this process'

const streamOf = (args: {
  host: SessionStream | null
  drain: DrainStateService
}): SessionStream => {
  if (args.drain.isDraining()) {
    throw new ServiceUnavailableException('the api is restarting — retry the stream')
  }
  if (args.host === null) throw new ServiceUnavailableException(HOST_ABSENT)
  return args.host
}

@Router({ alias: 'sessionStream' })
@UseMiddlewares(SessionMiddleware)
export class SessionStreamRouter {
  constructor(
    @Optional()
    @Inject(SESSION_STREAM)
    private readonly stream: SessionStream | null = null,
    private readonly drain: DrainStateService,
  ) {}

  @Subscription({ input: sessionStreamFollowInputSchema, output: sessionStreamOutputSchema })
  follow(
    @Input() input: SessionStreamFollowInput,
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<StreamServerMessage> {
    return streamOf({ host: this.stream, drain: this.drain }).follow({
      userId: ctx.auth.userId,
      sessionId: input.sessionId,
      afterSeq: input.afterSeq,
      afterHash: input.afterHash,
      signal: opts.signal,
    })
  }

  @Subscription({ output: sessionStreamOutputSchema })
  list(
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<StreamServerMessage> {
    return streamOf({ host: this.stream, drain: this.drain }).list({
      userId: ctx.auth.userId,
      signal: opts.signal,
    })
  }
}
