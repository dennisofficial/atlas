import type { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBlobStore } from './artifact-blob-store'
import { S3ArtifactBlobStore } from './s3-artifact-blob-store'
import { VercelArtifactBlobStore } from './vercel-artifact-blob-store'

export const artifactBlobStoreOf = (env: EnvService): ArtifactBlobStore =>
  env.get('ARTIFACT_STORAGE') === 's3'
    ? new S3ArtifactBlobStore({ env })
    : new VercelArtifactBlobStore(env)
