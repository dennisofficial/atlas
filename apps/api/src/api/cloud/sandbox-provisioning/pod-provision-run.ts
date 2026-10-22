import {
  API_PROVISIONED_ENV,
  createBootReporter,
  EBootStep,
  EBootStepState,
  type BootStepEvent,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { failureText, type SandboxWakeBoot } from '../github/github-sandbox-wake-boot'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import type { PodProvisionOutput, PodProvisionPayload } from './pod-provision.contract'
import { workspaceSpecWriter } from './sandbox-provisioning-bootstrap'
import { markFailed, markRunning } from './sandbox-provisioning-rows'

export type PodProvisionDeps = {
  cipher: SecretCipherService
  scoped: ScopedConfigService
  boot: SandboxWakeBoot
  image: string
  cloudUrl: string
  log: (line: string) => void
}

export async function runPodProvision(args: {
  payload: PodProvisionPayload
  deps: PodProvisionDeps
}): Promise<PodProvisionOutput> {
  const { payload, deps } = args
  const { threadId } = payload
  const wakeClaim = new Date(payload.wakeClaim)
  const row = await db.orm.public.CloudSandbox.first({ threadId })
  if (row === null || row.wakeClaim?.getTime() !== wakeClaim.getTime()) {
    deps.log(`pod-provision for thread ${threadId} was superseded; nothing to do`)
    return { outcome: 'superseded' }
  }

  let errorReported = false
  const reporter = createBootReporter({
    log: deps.log,
    sink: async (steps: readonly BootStepEvent[]) => {
      if (steps.some((step) => step.state === EBootStepState.Error)) errorReported = true
      await recordBootSteps({ threadId, steps })
    },
  })

  try {
    if (row.sealedToken === null) throw new Error('the sandbox row holds no session token')
    const token = deps.cipher.decrypt(row.sealedToken)
    const thread = await db.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const credentials = await deps.scoped.vercelCredentials({ thread })
    const { serveUrl } = await deps.boot.boot({
      credentials,
      name: row.name,
      threadId,
      image: deps.image,
      cloudUrl: deps.cloudUrl,
      serveVersion: undefined,
      freshToken: token,
      resumeToken: token,
      onFreshSandbox: () => Promise.resolve(),
      injectVercelCredentials: false,
      environment: { [API_PROVISIONED_ENV]: '1' },
      reporter,
      prepare: workspaceSpecWriter({ projectId: thread.projectId, model: thread.modelRef }),
    })
    const marked = await markRunning({ threadId, wakeClaim, serveUrl })
    if (!marked) return { outcome: 'superseded' }
    deps.log(`provisioned sandbox ${row.name} for thread ${threadId} — serve at ${serveUrl}`)
    return { outcome: 'running' }
  } catch (failure) {
    deps.log(
      `provisioning sandbox ${row.name} for thread ${threadId} failed: ${failureText(failure)}`,
    )
    await markFailed({ threadId, wakeClaim })
    if (!errorReported) {
      await recordBootSteps({
        threadId,
        steps: [
          { step: EBootStep.Provision, state: EBootStepState.Error, error: failureText(failure) },
        ],
      })
    }
    return { outcome: 'failed' }
  }
}
