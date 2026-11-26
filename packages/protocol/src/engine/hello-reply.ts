import type { DaemonFrame } from '../frames'

export const helloReplyOf = (args: {
  bootId: string
  version: string
  capabilities?: readonly string[] | undefined
}): DaemonFrame => ({
  kind: 'hello-reply',
  bootId: args.bootId,
  version: args.version,
  capabilities: [...(args.capabilities ?? [])],
})
