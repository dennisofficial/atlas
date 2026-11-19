import {
  type ProcedureOptions,
  Ctx,
  Input,
  Options,
  Router,
  Subscription,
  UseMiddlewares,
} from 'nestjs-trpc'
import {
  terminalStreamAttachInputSchema,
  terminalStreamFrameSchema,
  type TerminalStreamAttachInput,
  type TerminalStreamFrame,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { TerminalStreamService } from './terminal-stream.service'

@Router({ alias: 'terminalStream' })
@UseMiddlewares(SessionMiddleware)
export class TerminalStreamRouter {
  constructor(private readonly streams: TerminalStreamService) {}

  @Subscription({
    input: terminalStreamAttachInputSchema,
    output: terminalStreamFrameSchema,
  })
  attach(
    @Input() input: TerminalStreamAttachInput,
    @Ctx() ctx: SessionTrpcCtx,
    @Options() opts: ProcedureOptions,
  ): AsyncGenerator<TerminalStreamFrame> {
    return this.streams.attach({
      userId: ctx.auth.userId,
      sessionId: input.sessionId,
      cursors: input.cursors,
      signal: opts.signal,
    })
  }
}
