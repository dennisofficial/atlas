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
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import {
  EPodProvisionOutcome,
  type PodProvisionOutput,
  type PodProvisionPayload,
} from './pod-provision.contract'
import { workspaceSpecWriter } from './sandbox-provisioning-bootstrap'
import { claimHeld, markFailed, markRunning } from './sandbox-provisioning-rows'

export const PROVISION_TIMEOUT_MESSAGE = 'The sandbox took too long to start. Retry.'

export type PodProvisionDeps = {
  cipher: SecretCipherService
  scoped: ScopedConfigService
  boot: SandboxWakeBoot
  signals: Pick<ThreadSignalsService, 'podChanged'>
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
    return { outcome: EPodProvisionOutcome.Superseded }
  }

  let errorReported = false
  const reporter = createBootReporter({
    log: deps.log,
    sink: async (steps: readonly BootStepEvent[]) => {
      if (!(await claimHeld({ threadId, wakeClaim }))) return
      if (steps.some((step) => step.state === EBootStepState.Error)) errorReported = true
      await recordBootSteps({ threadId, steps })
      await deps.signals.podChanged({ threadId })
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
    if (!marked) return { outcome: EPodProvisionOutcome.Superseded }
    await deps.signals.podChanged({ threadId })
    deps.log(`provisioned sandbox ${row.name} for thread ${threadId} — serve at ${serveUrl}`)
    return { outcome: EPodProvisionOutcome.Running }
  } catch (failure) {
    deps.log(
      `provisioning sandbox ${row.name} for thread ${threadId} failed: ${failureText(failure)}`,
    )
    const matched = await markFailed({ threadId, wakeClaim })
    if (matched === 0) return { outcome: EPodProvisionOutcome.Superseded }
    await deps.signals.podChanged({ threadId })
    if (!errorReported) {
      await recordBootSteps({
        threadId,
        steps: [
          { step: EBootStep.Provision, state: EBootStepState.Error, error: failureText(failure) },
        ],
      })
      await deps.signals.podChanged({ threadId })
    }
    return { outcome: EPodProvisionOutcome.Failed }
  }
}

export async function failPodProvision(args: {
  payload: PodProvisionPayload
  signals: Pick<ThreadSignalsService, 'podChanged'>
}): Promise<void> {
  const { threadId, wakeClaim } = args.payload
  const matched = await markFailed({ threadId, wakeClaim: new Date(wakeClaim) })
  if (matched === 0) return
  await recordBootSteps({
    threadId,
    steps: [
      { step: EBootStep.Provision, state: EBootStepState.Error, error: PROVISION_TIMEOUT_MESSAGE },
    ],
  })
  await args.signals.podChanged({ threadId })
}
