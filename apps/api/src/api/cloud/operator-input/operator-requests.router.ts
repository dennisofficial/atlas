import {
  ConflictException,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { OPERATOR_ANSWERS, type OperatorAnswerService } from '../../../agent'
import { type OperatorAnswerInput, operatorAnswerInputSchema } from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'

export const HOST_ABSENT = 'the agent host is not mounted in this process'

const refusalOf = ({ status, body }: { status: number; body: unknown }): Error => {
  const reason = typeof body === 'object' && body !== null ? Reflect.get(body, 'reason') : undefined
  const message = typeof reason === 'string' ? reason : `the answer was refused (${status})`
  if (status === 403) return new ForbiddenException(message)
  if (status === 404) return new NotFoundException(message)
  if (status === 409) return new ConflictException(message)
  return new InternalServerErrorException(message)
}

@Router({ alias: 'operatorRequests' })
export class OperatorRequestsRouter {
  constructor(
    @Optional()
    @Inject(OPERATOR_ANSWERS)
    private readonly answers: OperatorAnswerService | null = null,
  ) {}

  @Mutation({ input: operatorAnswerInputSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async answer(@Input() input: OperatorAnswerInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    if (this.answers === null) throw new ServiceUnavailableException(HOST_ABSENT)
    const answer = await this.answers.answer({ userId: ctx.auth.userId, body: input })
    if (answer.status === 200) return
    throw refusalOf(answer)
  }
}
