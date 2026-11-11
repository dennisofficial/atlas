import { Injectable } from '@nestjs/common'
import { routePathOf, routePrefixOf, sourcePrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type { ArtifactUnpublishOutput } from '@dltech/atlas-wire'
import { ArtifactBlobStore } from './artifact-blob-store'
import { ownedArtifact } from './artifact-repository'
import { removeTree } from './artifact-tree'

@Injectable()
export class ArtifactLifecycleService {
  constructor(private readonly blobs: ArtifactBlobStore) {}

  async unpublish(args: { userId: string; slug: string }): Promise<ArtifactUnpublishOutput> {
    const artifact = await ownedArtifact(args)
    await this.blobs.delete({ pathname: routePathOf({ id: artifact.subdomain }) })
    await removeTree({ blobs: this.blobs, prefix: routePrefixOf({ id: artifact.subdomain }) })
    await removeTree({ blobs: this.blobs, prefix: sourcePrefixOf({ id: artifact.subdomain }) })
    await db.orm.public.Artifact.where({ id: artifact.id }).deleteAndCount()
    return { ok: true }
  }
}
