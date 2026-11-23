import { classifierTestOutputSchema, type ClassifierTestOutput } from '@dltech/atlas-wire'
import { Ctx, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ClassifierService } from './classifier.service'

@Router({ alias: 'classifier' })
@UseMiddlewares(SessionMiddleware)
export class ClassifierRouter {
  constructor(private readonly classifier: ClassifierService) {}

  @Mutation({ output: classifierTestOutputSchema })
  test(@Ctx() ctx: SessionTrpcCtx): Promise<ClassifierTestOutput> {
    return this.classifier.test({ userId: ctx.auth.userId })
  }
}
