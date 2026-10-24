import {
  publishedBundleCommitSchema,
  publishedBundleCurrentSchema,
  publishedBundleSummarySchema,
  publishedBundleUploadSchema,
  type PublishedBundleCommit,
  type PublishedBundleCurrent,
  type PublishedBundleSummary,
  type PublishedBundleUpload,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { markNoStore } from '../no-store'
import { PublishedBundlesService } from './published-bundles.service'

@Router({ alias: 'publishedBundles' })
export class PublishedBundlesRouter {
  constructor(private readonly bundles: PublishedBundlesService) {}

  @Mutation({ output: publishedBundleUploadSchema })
  @UseMiddlewares(SessionMiddleware)
  issueUpload(@Ctx() ctx: SessionTrpcCtx): Promise<PublishedBundleUpload> {
    markNoStore(ctx)
    return this.bundles.issueUpload({ userId: ctx.auth.userId })
  }

  @Mutation({ input: publishedBundleCommitSchema, output: publishedBundleSummarySchema })
  @UseMiddlewares(SessionMiddleware)
  commit(
    @Input() input: PublishedBundleCommit,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<PublishedBundleSummary> {
    markNoStore(ctx)
    return this.bundles.commit({ userId: ctx.auth.userId, body: input })
  }

  @Query({
    output: publishedBundleCurrentSchema,
    meta: meta({ podReachable: true, sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  current(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<PublishedBundleCurrent> {
    markNoStore(ctx)
    return this.bundles.current({ userId: ctx.auth.userId })
  }
}
