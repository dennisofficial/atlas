import { Logger } from '@nestjs/common'
import { liveSdk } from '@dltech/atlas-wire'
import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { sandboxWakeBootProvider } from '../../api/cloud/github/github-sandbox-wake-boot'
import type { PodProvisionDeps } from '../../api/cloud/sandbox-provisioning/pod-provision-run'
import { ScopedConfigService } from '../../api/cloud/scoped-config/scoped-config.service'
import { workerEnvService } from '../github/github-sweep-graph'
import { buildWorkerThreadSignals, type WorkerThreadSignals } from '../thread-signals-graph'

const DEFAULT_CLOUD_URL = 'https://api.byatlas.io'

export type PodProvisionGraph = { deps: PodProvisionDeps; dispose: WorkerThreadSignals['dispose'] }

export function buildPodProvisionGraph(args: { env: EnvService }): PodProvisionGraph {
  const { env } = args
  const { signals, dispose } = buildWorkerThreadSignals({ env })
  const cipher = new SecretCipherService(env)
  const logger = new Logger('PodProvision')
  const deps: PodProvisionDeps = {
    cipher,
    scoped: new ScopedConfigService(cipher),
    boot: sandboxWakeBootProvider.useFactory(),
    sdk: liveSdk,
    signals,
    image: env.get('SANDBOX_IMAGE'),
    cloudUrl: env.get('ATLAS_CLOUD_URL') ?? DEFAULT_CLOUD_URL,
    log: (line) => logger.log(line),
  }
  return { deps, dispose }
}

export const buildPodProvisionDeps = (args: { env: EnvService }): PodProvisionDeps =>
  buildPodProvisionGraph(args).deps

export const workerPodProvisionGraph = (): PodProvisionGraph =>
  buildPodProvisionGraph({ env: workerEnvService() })
