import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { ScopedSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/scoped-sandbox-credentials.service'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { CloudflareTunnelClient } from '@dltech/atlas-previews'
import { PreviewTunnelService } from '../../api/platform/sandboxes/preview-tunnel.service'
import { SandboxesService } from '../../api/platform/sandboxes/sandboxes.service'
import { VercelSandboxClient } from '../../api/platform/sandboxes/vercel-sandbox.client'
import type { ThreadArchiveCleanupDeps } from '../../api/platform/sessions/thread-archive-cleanup-run'
import { workerEnvService } from '../github/github-sweep-graph'
import { buildWorkerThreadSignals } from '../thread-signals-graph'

export function buildThreadArchiveCleanupDeps(args: { env: EnvService }): ThreadArchiveCleanupDeps {
  const { env } = args
  const cipher = new SecretCipherService(env)
  const vercel = new VercelSandboxClient(
    new ScopedSandboxCredentialsService(buildScopedConfig({ cipher, env }), env),
  )
  const { signals } = buildWorkerThreadSignals({ env })
  const sandboxes = new SandboxesService(vercel, cipher, signals)
  const previews = new PreviewTunnelService(
    env,
    cipher,
    new CloudflareTunnelClient({
      apiToken: env.get('CLOUDFLARE_API_TOKEN'),
      accountId: env.get('CLOUDFLARE_ACCOUNT_ID'),
      zoneId: env.get('CLOUDFLARE_ZONE_ID'),
    }),
  )
  return {
    park: (parkArgs) => sandboxes.park(parkArgs),
    teardownPreviews: (teardownArgs) => previews.teardown(teardownArgs),
  }
}

export const workerThreadArchiveCleanupDeps = (): ThreadArchiveCleanupDeps =>
  buildThreadArchiveCleanupDeps({ env: workerEnvService() })
