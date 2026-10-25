import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { ThreadSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/thread-sandbox-credentials.service'
import { ScopedConfigService } from '../../api/cloud/scoped-config/scoped-config.service'
import { SandboxesService } from '../../api/platform/sandboxes/sandboxes.service'
import { VercelSandboxClient } from '../../api/platform/sandboxes/vercel-sandbox.client'
import type { ThreadArchiveCleanupDeps } from '../../api/platform/sessions/thread-archive-cleanup-run'
import { workerEnvService } from '../github/github-sweep-graph'
import { buildWorkerThreadSignals } from '../thread-signals-graph'

export function buildThreadArchiveCleanupDeps(args: { env: EnvService }): ThreadArchiveCleanupDeps {
  const { env } = args
  const cipher = new SecretCipherService(env)
  const vercel = new VercelSandboxClient(
    new ThreadSandboxCredentialsService(new ScopedConfigService(cipher), env),
  )
  const { signals } = buildWorkerThreadSignals({ env })
  const sandboxes = new SandboxesService(vercel, cipher, signals)
  return { park: (parkArgs) => sandboxes.park(parkArgs) }
}

export const workerThreadArchiveCleanupDeps = (): ThreadArchiveCleanupDeps =>
  buildThreadArchiveCleanupDeps({ env: workerEnvService() })
