import { Logger } from '@nestjs/common'
import type { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { sandboxWakeBootProvider } from '../../api/cloud/github/github-sandbox-wake-boot'
import type { PodProvisionDeps } from '../../api/cloud/sandbox-provisioning/pod-provision-run'
import { ScopedConfigService } from '../../api/cloud/scoped-config/scoped-config.service'
import { workerEnvService } from '../github/github-sweep-graph'

const DEFAULT_CLOUD_URL = 'https://api.byatlas.io'

export function buildPodProvisionDeps(args: { env: EnvService }): PodProvisionDeps {
  const { env } = args
  const cipher = new SecretCipherService(env)
  const logger = new Logger('PodProvision')
  return {
    cipher,
    scoped: new ScopedConfigService(cipher),
    boot: sandboxWakeBootProvider.useFactory(),
    image: env.get('SANDBOX_IMAGE'),
    cloudUrl: env.get('ATLAS_CLOUD_URL') ?? DEFAULT_CLOUD_URL,
    log: (line) => logger.log(line),
  }
}

export const workerPodProvisionDeps = (): PodProvisionDeps =>
  buildPodProvisionDeps({ env: workerEnvService() })
