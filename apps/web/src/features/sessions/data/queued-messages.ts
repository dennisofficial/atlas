import {
  EAttachmentStore,
  pendingMessagesOf,
  type Attachment,
  type PendingInput,
  type PendingInputsState,
} from '@dltech/atlas-core'
import {
  queuedMessagesOf,
  stagedQueuedMessagesOf,
  type QueuedMessage,
} from '@dltech/atlas-client/session'
import type { StagedInput } from '@dltech/atlas-client/stream'
import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
} from '@dltech/atlas-ui/ai/queued-messages'

export { queuedNoticesOf } from '@dltech/atlas-client/session'

const NO_URLS: ReadonlyMap<string, string> = new Map()

const storedHashOf = (attachment: Attachment): string | undefined =>
  attachment.content.store === EAttachmentStore.Media ? attachment.content.hash : undefined

export type StagedMessage = StagedInput & {
  text: string
  attachments: readonly Attachment[]
}

export const pendingOf = (pending: PendingInputsState): readonly PendingInput[] =>
  pendingMessagesOf(pending)

export const queuedMediaHashesOf = (args: {
  pending: PendingInputsState
  staged: readonly StagedMessage[]
}): string[] => [
  ...new Set(
    [
      ...pendingOf(args.pending).map((input) => input.message?.attachments),
      ...args.staged.map((input) => input.attachments),
    ].flatMap((attachments) =>
      (attachments ?? []).flatMap((attachment) => {
        const hash = storedHashOf(attachment)
        return hash === undefined ? [] : [hash]
      }),
    ),
  ),
]

const attachmentsOf = (args: {
  attachments: readonly Attachment[] | undefined
  urls: ReadonlyMap<string, string>
}): QueuedAttachment[] =>
  (args.attachments ?? []).map((attachment) => {
    const hash = storedHashOf(attachment)
    const previewUrl = hash === undefined ? undefined : args.urls.get(hash)
    return {
      id: attachment.id,
      name: attachment.name,
      kind: attachment.mediaType.startsWith('image/')
        ? EQueuedAttachmentKind.Image
        : EQueuedAttachmentKind.File,
      size: attachment.size,
      ...(previewUrl === undefined ? {} : { previewUrl }),
    }
  })

const entryOf = (args: {
  message: QueuedMessage
  urls: ReadonlyMap<string, string>
}): QueuedMessageEntry => ({
  id: args.message.id,
  text: args.message.text,
  attachments: attachmentsOf({ attachments: args.message.attachments, urls: args.urls }),
})

export const visibleQueuedOf = (args: {
  pending: PendingInputsState
  urls?: ReadonlyMap<string, string> | undefined
}): QueuedMessageEntry[] =>
  queuedMessagesOf(args.pending).map((message) => entryOf({ message, urls: args.urls ?? NO_URLS }))

export const stagedQueuedOf = (args: {
  staged: readonly StagedMessage[]
  urls?: ReadonlyMap<string, string> | undefined
}): QueuedMessageEntry[] =>
  stagedQueuedMessagesOf(args.staged).map((message) =>
    entryOf({ message, urls: args.urls ?? NO_URLS }),
  )

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`
