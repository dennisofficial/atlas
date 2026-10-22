import {
  EFirstMessage,
  ENewThreadOutcome,
  EPodProgress,
  isStartingPod,
  startPodOf,
} from './new-thread-types'

export interface ThreadCore {
  pod: EPodProgress
  message: EFirstMessage
  prompt: string
  draft: string
}

interface SendInput {
  core: ThreadCore
  text: string
  outcome: ENewThreadOutcome
}

interface OutcomeInput {
  core: ThreadCore
  outcome: ENewThreadOutcome
}

export function sendFrom({ core, text, outcome }: SendInput): ThreadCore | undefined {
  if (core.message !== EFirstMessage.None) return undefined
  if (core.pod === EPodProgress.Ready) {
    return { ...core, message: EFirstMessage.Running, prompt: text, draft: '' }
  }
  const pod = isStartingPod(core.pod) ? core.pod : startPodOf(outcome)
  return { pod, message: EFirstMessage.Pending, prompt: text, draft: '' }
}

export function takeBackFrom(core: ThreadCore): ThreadCore {
  if (core.message !== EFirstMessage.Pending) return core
  return { ...core, message: EFirstMessage.None, prompt: '', draft: core.prompt }
}

export function retryFrom({ core, outcome }: OutcomeInput): ThreadCore {
  return { ...core, pod: startPodOf(outcome) }
}

export function advancePod({ core, outcome }: OutcomeInput): ThreadCore {
  if (core.pod === EPodProgress.WaitingForPod) {
    const failed = outcome === ENewThreadOutcome.ProvisionFailed
    return { ...core, pod: failed ? EPodProgress.ProvisionFailed : EPodProgress.SettingUpWorkspace }
  }
  if (core.pod !== EPodProgress.SettingUpWorkspace) return core
  const message = core.message === EFirstMessage.Pending ? EFirstMessage.Running : core.message
  return { ...core, pod: EPodProgress.Ready, message }
}
