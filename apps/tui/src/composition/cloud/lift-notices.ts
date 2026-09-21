import { EChannelConnection } from '@dltech/atlas-harness'

import {
  ECloudSandboxState,
  type CloudConnection,
  type CloudSandboxStatus,
} from './cloud-bridge'
import { ELiftFault, ELiftStep, type LiftFailure } from './lift'

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
  [ELiftFault.Unreachable]: 'Atlas Cloud could not be reached',
  [ELiftFault.PatchTooLarge]: 'the uncommitted work is too large to carry',
  [ELiftFault.Transfer]: 'the conversation could not be transferred',
  [ELiftFault.Sandbox]: 'the sandbox would not start',
  [ELiftFault.Context]: 'the context could not reach the sandbox',
}

const stillHere = (failure: LiftFailure): string =>
  failure.step === ELiftStep.Transferring || failure.step === ELiftStep.Flipping
    ? 'nothing moved and this conversation still runs here'
    : `this conversation still runs here${stoppedTail(failure)}`

export const liftFailedNotice = (failure: LiftFailure): string =>
  `${FAULT_HEAD[failure.fault]} — ${stillHere(failure)}. ${failure.detail}`

/**
 * A stopped sandbox cannot say that it stopped, so a socket that will not come back is read against
 * the control plane rather than guessed at: parked is an ordinary resting state, and only a sandbox
 * the control plane has never heard of is a failure.
 */
export const closedConnectionOf = (status: CloudSandboxStatus | undefined): CloudConnection => {
  if (status === undefined) {
    return {
      state: EChannelConnection.Closed,
      detail: 'the control plane has no sandbox for this conversation',
    }
  }

  if (status.state === ECloudSandboxState.Parked) {
    return { state: EChannelConnection.Parked, detail: null }
  }

  if (status.state === ECloudSandboxState.Resuming) {
    return { state: EChannelConnection.Reconnecting, detail: 'the sandbox is resuming' }
  }

  return {
    state: EChannelConnection.Closed,
    detail: 'the control plane says the sandbox is running, but it is not answering',
  }
}
