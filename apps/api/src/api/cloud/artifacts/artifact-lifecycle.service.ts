import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { routePathOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type {
  ArtifactRollbackInput,
  ArtifactRollbackOutput,
  ArtifactUnpublishOutput,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBlobStore } from './artifact-blob-store'
import { ownedArtifact, urlOf } from './artifact-repository'
import { manifestOf, specOf, statusOf } from './artifact-rows'
import { writeArtifactRoute } from './artifact-route'
import { ArtifactRetention } from './artifact-retention'

@Injectable()
export class ArtifactLifecycleService {
  constructor(
    private readonly blobs: ArtifactBlobStore,
    private readonly retention: ArtifactRetention,
    private readonly env: EnvService,
  ) {}

  async rollback(args: {
    userId: string
    body: ArtifactRollbackInput
  }): Promise<ArtifactRollbackOutput> {
    const artifact = await ownedArtifact({ userId: args.userId, slug: args.body.slug })
    const target = await db.orm.public.ArtifactVersion.first({
      artifactId: artifact.id,
      version: args.body.version,
    })
    if (target === null) throw new NotFoundException(`no version ${args.body.version}`)
    if (statusOf(target.status) !== 'ready') {
      throw new BadRequestException(`version ${target.version} is not ready`)
    }
    const manifest = manifestOf(target)
    await db.orm.public.Artifact.where({ id: artifact.id }).update({
      currentVersion: target.version,
    })
    await writeArtifactRoute({
      blobs: this.blobs,
      artifact,
      version: target.version,
      manifest,
      spec: specOf(target),
    })
    return {
      url: urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') }),
      version: target.version,
    }
  }

  async unpublish(args: { userId: string; slug: string }): Promise<ArtifactUnpublishOutput> {
    const artifact = await ownedArtifact(args)
    await db.orm.public.Artifact.where({ id: artifact.id }).deleteAndCount()
    await this.blobs.delete({ pathname: routePathOf(artifact) })
    this.retention.afterUnpublish()
    return { ok: true }
  }
}
