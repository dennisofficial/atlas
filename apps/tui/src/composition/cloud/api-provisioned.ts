import { ERunner, type SecretsPort, type ThreadId } from '@dltech/atlas-core'
import { sandboxServeTokenName } from '@dltech/atlas-harness'

export const isApiProvisioned = (args: {
  secrets: SecretsPort
  threadId: ThreadId
  runner: ERunner
}): boolean =>
  args.runner === ERunner.Vercel &&
  (args.secrets.read(sandboxServeTokenName(args.threadId))?.length ?? 0) === 0
