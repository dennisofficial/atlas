import type { ProductAnalytics } from '@dltech/atlas-observability'
import { serverObservability, type ServerObservability } from '@dltech/atlas-observability/node'
import { liveSdk } from '@dltech/atlas-wire'
import type { EnvService } from '../../_core/config/env/env.service'
import { apiVersion } from '../../_lib/version/api-version'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { sandboxWakeBootProvider } from '../../api/cloud/github/github-sandbox-wake-boot'
import type { PodProvisionDeps } from '../../api/cloud/sandbox-provisioning/pod-provision-run'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { validatedEnvService } from '../../_core/config/env/validated-env'
import { triggerLog } from '../trigger-logger'
import { buildWorkerThreadSignals, type WorkerThreadSignals } from '../thread-signals-graph'

const DEFAULT_CLOUD_URL = 'https://api.byatlas.io'

export type PodProvisionGraph = { deps: PodProvisionDeps; dispose: WorkerThreadSignals['dispose'] }

const provisionObservability = (
  threadId: string | undefined,
): { observability: ServerObservability; trace: PodProvisionDeps['trace'] } | undefined => {
  if (threadId === undefined) return undefined
  const observability = serverObservability({ version: apiVersion() })
  return { observability, trace: observability.traceFor(threadId) }
}

export const flushQuietly = async (analytics: ProductAnalytics | undefined): Promise<void> => {
  try {
    await analytics?.flush()
  } catch {
    return
  }
}

export function buildPodProvisionGraph(args: {
  env: EnvService
  threadId?: string | undefined
}): PodProvisionGraph {
  const { env } = args
  const { signals, dispose } = buildWorkerThreadSignals({ env })
  const tracing = provisionObservability(args.threadId)
  const cipher = new SecretCipherService(env)
  const deps: PodProvisionDeps = {
    cipher,
    scoped: buildScopedConfig({ cipher, env }),
    boot: sandboxWakeBootProvider.useFactory(),
    sdk: liveSdk,
    signals,
    image: env.get('SANDBOX_IMAGE'),
    cloudUrl: env.get('ATLAS_CLOUD_URL') ?? DEFAULT_CLOUD_URL,
    log: (line) => triggerLog.log(line),
    telemetryPepper: env.get('ATLAS_TELEMETRY_PEPPER'),
    ...(tracing === undefined ? {} : { trace: tracing.trace }),
  }
  return {
    deps,
    dispose: async () => {
      await dispose()
      await flushQuietly(tracing?.observability.analytics)
    },
  }
}

export const buildPodProvisionDeps = (args: {
  env: EnvService
  threadId?: string | undefined
}): PodProvisionDeps => buildPodProvisionGraph(args).deps

export const workerPodProvisionGraph = (
  args: { threadId?: string | undefined } = {},
): PodProvisionGraph =>
  buildPodProvisionGraph({ env: validatedEnvService(), threadId: args.threadId })
