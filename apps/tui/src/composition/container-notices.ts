import { EExecutionLocation } from '@dltech/atlas-core'

const WHERE_IT_RUNS: Record<EExecutionLocation, string> = {
  [EExecutionLocation.Host]: 'on the host',
  [EExecutionLocation.Docker]: 'in a Docker container',
  [EExecutionLocation.Cloud]: 'in a cloud sandbox',
}

const whereItRuns = (location: EExecutionLocation): string => WHERE_IT_RUNS[location]

export const currentLocationNotice = (location: EExecutionLocation): string =>
  `this conversation runs ${whereItRuns(location)}`

export const resourcesRefusalNotice = (location: EExecutionLocation): string =>
  `sandbox resources can only be resized live while this conversation runs in a cloud sandbox — it runs ${whereItRuns(location)}. The default for new sandboxes is in settings (ctrl+o) › cloud`

export const resourcesConnectingNotice =
  'the sandbox is still connecting — /container resources works once the channel is open'
