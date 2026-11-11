import {
  artifactBeginPublishInputSchema,
  artifactBeginPublishOutputSchema,
  artifactCommitPublishInputSchema,
  artifactCommitPublishOutputSchema,
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactRollbackInputSchema,
  artifactRollbackOutputSchema,
  artifactSlugInputSchema,
  artifactSourceExportOutputSchema,
  artifactUnpublishOutputSchema,
  type ArtifactBeginPublishInput,
  type ArtifactBeginPublishOutput,
  type ArtifactCommitPublishInput,
  type ArtifactCommitPublishOutput,
  type ArtifactGetOutput,
  type ArtifactListOutput,
  type ArtifactRollbackInput,
  type ArtifactRollbackOutput,
  type ArtifactSlugInput,
  type ArtifactSourceExportOutput,
  type ArtifactUnpublishOutput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactsService } from './artifacts.service'

const reachable = meta({ podReachable: true, sandboxReachable: true })

@Router({ alias: 'artifacts' })
export class ArtifactsRouter {
  constructor(
    private readonly artifacts: ArtifactsService,
    private readonly library: ArtifactLibraryService,
    private readonly lifecycle: ArtifactLifecycleService,
  ) {}

  @Mutation({
    input: artifactBeginPublishInputSchema,
    output: artifactBeginPublishOutputSchema,
    meta: reachable,
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  beginPublish(
    @Input() input: ArtifactBeginPublishInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ArtifactBeginPublishOutput> {
    return this.artifacts.beginPublish({ userId: ctx.auth.userId, body: input })
  }

  @Mutation({
    input: artifactCommitPublishInputSchema,
    output: artifactCommitPublishOutputSchema,
    meta: reachable,
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  commitPublish(
    @Input() input: ArtifactCommitPublishInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ArtifactCommitPublishOutput> {
    return this.artifacts.commitPublish({
      userId: ctx.auth.userId,
      threadId: ctx.sandbox?.threadId ?? ctx.pod?.threadId,
      body: input,
    })
  }

  @Query({ output: artifactListOutputSchema, meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  list(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<ArtifactListOutput> {
    return this.library.list({ userId: ctx.auth.userId })
  }

  @Query({ input: artifactSlugInputSchema, output: artifactGetOutputSchema, meta: reachable })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  get(
    @Input() input: ArtifactSlugInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ArtifactGetOutput> {
    return this.library.get({ userId: ctx.auth.userId, slug: input.slug })
  }

  @Query({
    input: artifactSlugInputSchema,
    output: artifactSourceExportOutputSchema,
    meta: reachable,
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  sourceExport(
    @Input() input: ArtifactSlugInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ArtifactSourceExportOutput> {
    return this.library.sourceExport({ userId: ctx.auth.userId, slug: input.slug })
  }

  @Mutation({
    input: artifactRollbackInputSchema,
    output: artifactRollbackOutputSchema,
    meta: reachable,
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  rollback(
    @Input() input: ArtifactRollbackInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ArtifactRollbackOutput> {
    return this.lifecycle.rollback({ userId: ctx.auth.userId, body: input })
  }

  @Mutation({
    input: artifactSlugInputSchema,
    output: artifactUnpublishOutputSchema,
    meta: reachable,
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  unpublish(
    @Input() input: ArtifactSlugInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ArtifactUnpublishOutput> {
    return this.lifecycle.unpublish({ userId: ctx.auth.userId, slug: input.slug })
  }
}
