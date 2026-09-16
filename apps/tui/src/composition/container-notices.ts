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

export const pendingSwitchNotice = (args: {
  target: EExecutionLocation
  count: number
}): string =>
  `moving ${whereItRuns(args.target)} stops ${args.count} running ${args.count === 1 ? 'shell' : 'shells'} — confirm below`

export const relocatedNotice = (args: {
  target: EExecutionLocation
  stoppedServices: number
  relocatedAgents: number
}): string => {
  const parts: string[] = []
  if (args.stoppedServices > 0) {
    parts.push(`stopped ${args.stoppedServices} ${args.stoppedServices === 1 ? 'service' : 'services'}`)
  }
  if (args.relocatedAgents > 0) {
    parts.push(
      `moved ${args.relocatedAgents} ${args.relocatedAgents === 1 ? 'sub-agent' : 'sub-agents'} with you`,
    )
  }

  if (parts.length === 0) return movedLocationNotice(args.target)
  return `${movedLocationNotice(args.target)} — ${parts.join(', ')}`
}
