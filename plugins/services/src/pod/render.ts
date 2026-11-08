import { shellLabel } from '@dltech/atlas-core'

export const renderStarted = (args: {
  serviceId: string
  pid: number
  description: string
}): string =>
  [
    `Started ${args.serviceId} (pid ${args.pid}) - ${args.description}.`,
    'It keeps running after this turn ends and nobody waits on it; its ending arrives on its own, so do not poll for it.',
    `Stop it with service_stop({ serviceId: "${args.serviceId}" }), or service_restart after you change its command.`,
  ].join('\n')

export const renderStopped = (args: { serviceId: string }): string =>
  `Sent the stop to service ${args.serviceId} and its process group. Its ending is recorded and delivered on its own, so do not wait for it or poll.`

export const renderListLine = (args: {
  serviceId: string
  command: string
  description?: string | undefined
  running: boolean
  port: number | null
}): string =>
  [
    args.serviceId,
    shellLabel(args),
    args.running ? 'running' : 'ended',
    ...(args.port === null ? [] : [`port ${args.port}`]),
  ].join('  ')
