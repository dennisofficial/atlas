import {
  All,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common'

import {
  OPERATOR_ANSWER_PATH,
  OperatorAnswerService,
  operatorAnswerRequestSchema,
  type OperatorAnswerRequest,
} from '../operator-input/answer-service'
import { OPERATOR_ANSWERS } from '../host/tokens'
import { BearerAuthGuard } from './bearer-auth.guard'
import { CurrentUserId } from './current-user.decorator'
import type { HostReply } from './host-request'
import { OriginGuard } from './origin.guard'
import { ZodBodyPipe } from './zod-body.pipe'

@Controller({ version: VERSION_NEUTRAL })
export class OperatorRequestsController {
  constructor(@Inject(OPERATOR_ANSWERS) private readonly answers: OperatorAnswerService) {}

  @Post(OPERATOR_ANSWER_PATH)
  @UseGuards(OriginGuard, BearerAuthGuard)
  async handleAnswer(
    @CurrentUserId() userId: string,
    @Body(new ZodBodyPipe(operatorAnswerRequestSchema)) body: OperatorAnswerRequest,
    @Res() response: HostReply,
  ): Promise<void> {
    const answer = await this.answers.answer({ userId, body })
    response.status(answer.status)
    response.setHeader('cache-control', 'no-store')
    response.json(answer.body)
  }

  @All(OPERATOR_ANSWER_PATH)
  @HttpCode(405)
  handleOtherMethod(): { reason: string } {
    return { reason: 'method' }
  }
}
