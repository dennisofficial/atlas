import {
  artifactBeginPublishInputSchema,
  artifactBeginPublishOutputSchema,
  artifactCommitPublishInputSchema,
  artifactCommitPublishOutputSchema,
  artifactGetOutputSchema,
  artifactListOutputSchema,
  artifactSubdomainInputSchema,
  artifactSourceExportOutputSchema,
  artifactUnpublishOutputSchema,
  type ArtifactBeginPublishInput,
  type ArtifactBeginPublishOutput,
  type ArtifactCommitPublishInput,
  type ArtifactCommitPublishOutput,
  type ArtifactGetOutput,
  type ArtifactListOutput,
  type ArtifactSubdomainInput,
  type ArtifactSourceExportOutput,
  type ArtifactUnpublishOutput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactsService } from './artifacts.service'

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
  })
  @UseMiddlewares(SessionMiddleware)
  beginPublish(
    @Input() input: ArtifactBeginPublishInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ArtifactBeginPublishOutput> {
    return this.artifacts.beginPublish({ userId: ctx.auth.userId, body: input })
  }

  @Mutation({
    input: artifactCommitPublishInputSchema,
    output: artifactCommitPublishOutputSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  commitPublish(
    @Input() input: ArtifactCommitPublishInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ArtifactCommitPublishOutput> {
    return this.artifacts.commitPublish({ userId: ctx.auth.userId, body: input })
  }

  @Query({ output: artifactListOutputSchema })
  @UseMiddlewares(SessionMiddleware)
  list(@Ctx() ctx: SessionTrpcCtx): Promise<ArtifactListOutput> {
    return this.library.list({ userId: ctx.auth.userId })
  }

  @Query({ input: artifactSubdomainInputSchema, output: artifactGetOutputSchema })
  @UseMiddlewares(SessionMiddleware)
  get(
    @Input() input: ArtifactSubdomainInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ArtifactGetOutput> {
    return this.library.get({ userId: ctx.auth.userId, subdomain: input.subdomain })
  }

  @Query({
    input: artifactSubdomainInputSchema,
    output: artifactSourceExportOutputSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  sourceExport(
    @Input() input: ArtifactSubdomainInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ArtifactSourceExportOutput> {
    return this.library.sourceExport({ userId: ctx.auth.userId, subdomain: input.subdomain })
  }

  @Mutation({
    input: artifactSubdomainInputSchema,
    output: artifactUnpublishOutputSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  unpublish(
    @Input() input: ArtifactSubdomainInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ArtifactUnpublishOutput> {
    return this.lifecycle.unpublish({ userId: ctx.auth.userId, subdomain: input.subdomain })
  }
}
