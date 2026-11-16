import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { ArtifactBuild } from '../../api/cloud/artifacts/artifact-build'
import type { ArtifactBuildDeps } from '../../api/cloud/artifacts/artifact-build-run'
import { S3ArtifactBlobStore } from '../../api/cloud/artifacts/s3-artifact-blob-store'
import { VercelArtifactSandbox } from '../../api/cloud/artifacts/vercel-artifact-sandbox'
import { ScopedSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/scoped-sandbox-credentials.service'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { workerEnvService } from '../github/github-sweep-graph'

export function buildArtifactBuildDeps(args: { env: EnvService }): ArtifactBuildDeps {
  const { env } = args
  const cipher = new SecretCipherService(env)
  const credentials = new ScopedSandboxCredentialsService(buildScopedConfig({ cipher, env }), env)
  return {
    blobs: new S3ArtifactBlobStore({ env }),
    build: new ArtifactBuild(new VercelArtifactSandbox(credentials)),
  }
}

export const workerArtifactBuildDeps = (): ArtifactBuildDeps =>
  buildArtifactBuildDeps({ env: workerEnvService() })
