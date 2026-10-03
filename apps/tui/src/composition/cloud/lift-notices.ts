import { ELiftFault, ELiftStep, type LiftFailure } from '@dltech/atlas-harness'

export const CLOUD_LIFT_NOTICE_KEY = 'container-cloud'

export const CLOUD_SANDBOX_NOTICE_KEY = 'container-cloud-sandbox'

const stoppedTail = (failure: LiftFailure): string => {
  const { shells, services } = failure.stopped
  const parts: string[] = []
  if (shells.length > 0) parts.push(`${shells.length} ${shells.length === 1 ? 'shell' : 'shells'}`)
  if (services.length > 0) {
    parts.push(`${services.length} ${services.length === 1 ? 'service' : 'services'}`)
  }

  return parts.length === 0 ? '' : ` — stopped ${parts.join(' and ')}`
}

const FAULT_HEAD: Record<ELiftFault, string> = {
  [ELiftFault.NotConfigured]: 'cloud sandboxes are not set up',
  [ELiftFault.GitAuth]: 'git access is not set up',
  [ELiftFault.Unreachable]: 'Atlas Cloud could not be reached',
  [ELiftFault.PatchTooLarge]: 'the uncommitted work is too large to carry',
  [ELiftFault.Transfer]: 'the conversation could not be transferred',
  [ELiftFault.Sandbox]: 'the sandbox would not start',
  [ELiftFault.Context]: 'the context could not reach the sandbox',
}

const stillHere = (failure: LiftFailure): string => {
  if (failure.step === ELiftStep.Attaching) {
    return 'this conversation moved to the cloud, but attaching to it failed — /container cloud again to reconnect'
  }
  if (failure.step === ELiftStep.Transferring || failure.step === ELiftStep.Flipping) {
    return 'nothing moved and this conversation still runs here'
  }
  return `this conversation still runs here${stoppedTail(failure)}`
}

export const liftFailedNotice = (failure: LiftFailure): string =>
  `${FAULT_HEAD[failure.fault]} — ${stillHere(failure)}. ${failure.detail}`

