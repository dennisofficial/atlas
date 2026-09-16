import { EChannelConnection } from '@dltech/atlas-harness'

import {
  ECloudSandboxState,
  type CloudConnection,
  type CloudSandboxStatus,
} from './cloud-bridge'
import { ELiftFault, ELiftStep, type LiftFailure, type LiftSuccess } from './lift'

export const CLOUD_LIFT_NOTICE_KEY = 'container-cloud'

export const CLOUD_CONNECTION_NOTICE_KEY = 'container-cloud-connection'

export const CLOUD_SANDBOX_NOTICE_KEY = 'container-cloud-sandbox'

const STEP_TEXT: Record<ELiftStep, string> = {
  [ELiftStep.Transferring]: 'moving to the cloud — transferring the conversation',
  [ELiftStep.Flipping]: 'moving to the cloud — handing the conversation over',
  [ELiftStep.Stopping]: 'moving to the cloud — closing what is running here',
  [ELiftStep.Capturing]: 'moving to the cloud — packing the uncommitted work',
  [ELiftStep.Starting]: 'moving to the cloud — waiting for the sandbox',
  [ELiftStep.Attaching]: 'moving to the cloud — attaching',
}

export const liftProgressNotice = (step: ELiftStep): string => STEP_TEXT[step]

const stoppedTail = (lifted: LiftSuccess | LiftFailure): string => {
  const { shells, services } = lifted.stopped
  const parts: string[] = []
  if (shells.length > 0) parts.push(`${shells.length} ${shells.length === 1 ? 'shell' : 'shells'}`)
  if (services.length > 0) {
    parts.push(`${services.length} ${services.length === 1 ? 'service' : 'services'}`)
  }

  return parts.length === 0 ? '' : ` — stopped ${parts.join(' and ')}`
}

export const liftedNotice = (lifted: LiftSuccess): string =>
  `this conversation now runs in a cloud sandbox${stoppedTail(lifted)}`

const FAULT_HEAD: Record<ELiftFault, string> = {
  [ELiftFault.NotConfigured]: 'cloud sandboxes are not set up',
  [ELiftFault.Unreachable]: 'Atlas Cloud could not be reached',
  [ELiftFault.PatchTooLarge]: 'the uncommitted work is too large to carry',
  [ELiftFault.Transfer]: 'the conversation could not be transferred',
  [ELiftFault.Sandbox]: 'the sandbox would not start',
}

const stillHere = (failure: LiftFailure): string =>
  failure.step === ELiftStep.Transferring || failure.step === ELiftStep.Flipping
    ? 'nothing moved and this conversation still runs here'
    : `this conversation still runs here${stoppedTail(failure)}`

export const liftFailedNotice = (failure: LiftFailure): string =>
  `${FAULT_HEAD[failure.fault]} — ${stillHere(failure)}. ${failure.detail}`

const CONNECTION_TEXT: Record<EChannelConnection, string | null> = {
  [EChannelConnection.Connecting]: 'connecting to the cloud sandbox',
  [EChannelConnection.Open]: null,
  [EChannelConnection.Reconnecting]: 'reconnecting to the cloud sandbox',
  [EChannelConnection.Parked]: 'the cloud sandbox is parked — the next message wakes it',
  [EChannelConnection.Closed]: 'the cloud sandbox is not answering',
}

export const connectionNotice = (connection: CloudConnection): string | null => {
  const text = CONNECTION_TEXT[connection.state]
  if (text === null) return null
  if (connection.detail === null) return text

  return `${text} — ${connection.detail}`
}

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
