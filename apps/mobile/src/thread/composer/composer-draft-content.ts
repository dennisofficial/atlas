import type { DraftContent } from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'

export const draftContentOf = (args: {
  text: string
  carried: readonly Attachment[]
  attachments: readonly Attachment[]
}): DraftContent => ({
  text: args.text,
  attachments: [...args.carried, ...args.attachments],
})
