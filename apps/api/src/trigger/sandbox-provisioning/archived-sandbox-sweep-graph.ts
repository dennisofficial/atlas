import { Logger } from '@nestjs/common'
import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import type { ArchivedSandboxSweepDeps } from '../../api/cloud/sandbox-provisioning/archived-sandbox-sweep'
import { ScopedSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/scoped-sandbox-credentials.service'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { VercelSandboxClient } from '../../api/platform/sandboxes/vercel-sandbox.client'
import { workerEnvService } from '../github/github-sweep-graph'
import { buildWorkerThreadSignals, type WorkerThreadSignals } from '../thread-signals-graph'

export type ArchivedSandboxSweepGraph = {
  deps: ArchivedSandboxSweepDeps
  dispose: WorkerThreadSignals['dispose']
}

export function buildArchivedSandboxSweepGraph(args: {
  env: EnvService
}): ArchivedSandboxSweepGraph {
  const { env } = args
  const cipher = new SecretCipherService(env)
  const vercel = new VercelSandboxClient(
    new ScopedSandboxCredentialsService(buildScopedConfig({ cipher, env }), env),
  )
  const { signals, dispose } = buildWorkerThreadSignals({ env })
  const logger = new Logger('ArchivedSandboxSweep')
  return {
    deps: {
      deleteSandbox: (deleteArgs) => vercel.delete(deleteArgs),
      podChanged: (podArgs) => signals.podChanged(podArgs),
      log: (line) => logger.warn(line),
    },
    dispose,
  }
}

export const workerArchivedSandboxSweepGraph = (): ArchivedSandboxSweepGraph =>
  buildArchivedSandboxSweepGraph({ env: workerEnvService() })
