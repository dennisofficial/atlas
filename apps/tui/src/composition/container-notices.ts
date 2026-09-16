import { EExecutionLocation } from '@dltech/atlas-core'

const whereItRuns = (location: EExecutionLocation): string =>
  location === EExecutionLocation.Host ? 'on the host' : 'in a Docker container'

export const currentLocationNotice = (location: EExecutionLocation): string =>
  `this conversation runs ${whereItRuns(location)}`

export const movedLocationNotice = (location: EExecutionLocation): string =>
  location === EExecutionLocation.Host
    ? 'this conversation runs on the host again'
    : `this conversation now runs ${whereItRuns(location)} — a read outside the project will fail from the next turn on`

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
