import type { DaemonLink } from './link'

export const sendCancelScope = (args: {
  link: DaemonLink
  epoch(): number
  scope: string
}): void => {
  if (!args.link.ready) return
  args.link.send({ kind: 'cancel-scope', scope: args.scope, epoch: args.epoch() })
}
