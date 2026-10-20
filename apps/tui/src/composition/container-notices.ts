import { EExecutionLocation } from '@dltech/atlas-core'

const WHERE_IT_RUNS: Record<EExecutionLocation, string> = {
  [EExecutionLocation.Host]: 'on the host',
  [EExecutionLocation.Docker]: 'in a Docker container',
  [EExecutionLocation.Cloud]: 'in a cloud sandbox',
}

const whereItRuns = (location: EExecutionLocation): string => WHERE_IT_RUNS[location]

export const currentLocationNotice = (location: EExecutionLocation): string =>
  `this conversation runs ${whereItRuns(location)}`

export const movedLocationNotice = (location: EExecutionLocation): string => {
  if (location === EExecutionLocation.Host) return 'this conversation runs on the host again'
  if (location === EExecutionLocation.Cloud) {
    return 'this conversation now runs in a cloud sandbox — it keeps going with this terminal closed'
  }

  return `this conversation now runs ${whereItRuns(location)} — a read outside the project will fail from the next turn on`
}

const WHERE_IT_HEADS: Record<EExecutionLocation, string> = {
  [EExecutionLocation.Host]: 'back to the host',
  [EExecutionLocation.Docker]: 'into a Docker container',
  [EExecutionLocation.Cloud]: 'to the cloud',
}

export const movingNotice = (location: EExecutionLocation): string =>
  `moving ${WHERE_IT_HEADS[location]} — the composer is paused until the move settles`

export const moveFailedNotice = (args: {
  target: EExecutionLocation
  from: EExecutionLocation
  detail: string
}): string =>
  `moving ${WHERE_IT_HEADS[args.target]} did not finish — this conversation still runs ${WHERE_IT_RUNS[args.from]}. ${args.detail}`

export const resourcesRefusalNotice = (location: EExecutionLocation): string =>
  `sandbox resources can only be resized live while this conversation runs in a cloud sandbox — it runs ${whereItRuns(location)}. The default for new sandboxes is in settings (ctrl+o) › cloud`

export const resourcesConnectingNotice =
  'the sandbox is still connecting — /container resources works once the channel is open'

export const pendingSwitchNotice = (args: {
  target: EExecutionLocation
  count: number
}): string =>
  `moving ${whereItRuns(args.target)} stops ${args.count} running ${args.count === 1 ? 'shell' : 'shells'} — confirm below`

const WHERE_IT_LIVES: Record<EExecutionLocation, string> = {
  [EExecutionLocation.Host]: 'on the host',
  [EExecutionLocation.Docker]: 'in a Docker container',
  [EExecutionLocation.Cloud]: 'in a cloud sandbox',
}

/** A thread born on the host stays there; the answer to wanting the cloud is a cloud-born thread. */
export const bornLocalRefusalNotice = (): string =>
  'this thread was born on the host and stays there — threads keep the placement they were born with, so start a new thread to run in the cloud'

/** A cloud-born thread never comes down; the answer to wanting the host is a local-born thread. */
export const bornCloudRefusalNotice = (target: EExecutionLocation): string =>
  `this thread was born in the cloud and stays there — threads keep the placement they were born with, so start a new thread to run ${WHERE_IT_LIVES[target]}`
