import {
  dictationTokenInputSchema,
  dictationTokenReplySchema,
  type DictationTokenReply,
} from '@dltech/atlas-wire'
import { Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { DictationService } from './dictation.service'

@Router({ alias: 'dictation' })
export class DictationRouter {
  constructor(private readonly dictation: DictationService) {}

  @Mutation({ input: dictationTokenInputSchema, output: dictationTokenReplySchema })
  @UseMiddlewares(SessionMiddleware)
  token(): Promise<DictationTokenReply> {
    return this.dictation.token()
  }
}
