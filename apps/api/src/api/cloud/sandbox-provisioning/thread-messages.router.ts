import {
  threadMessageReplySchema,
  threadMessageSendInputSchema,
  threadMessageTakeBackInputSchema,
  type ThreadMessageReply,
  type ThreadMessageSendInput,
  type ThreadMessageTakeBackInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ThreadMessagesService } from './thread-messages.service'

@Router({ alias: 'threadMessages' })
@UseMiddlewares(SessionMiddleware)
export class ThreadMessagesRouter {
  constructor(private readonly messages: ThreadMessagesService) {}

  @Mutation({ input: threadMessageSendInputSchema, output: threadMessageReplySchema })
  send(
    @Input() input: ThreadMessageSendInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ThreadMessageReply> {
    return this.messages.send({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      sendId: input.sendId,
      text: input.text,
    })
  }

  @Mutation({ input: threadMessageTakeBackInputSchema, output: z.void() })
  takeBack(@Input() input: ThreadMessageTakeBackInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.messages.takeBack({
      userId: ctx.auth.userId,
      threadId: input.threadId,
      sendId: input.sendId,
    })
  }
}
