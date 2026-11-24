import type { Attachment } from '@dltech/atlas-core'
import type { EOutgoingPlacement, StagedInput } from '@dltech/atlas-client/stream'

export { queuedNoticesOf } from '@dltech/atlas-client/session'

export type StagedMessage = StagedInput & {
  text: string
  attachments: readonly Attachment[]
  placement: EOutgoingPlacement
  at: string
}

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`
