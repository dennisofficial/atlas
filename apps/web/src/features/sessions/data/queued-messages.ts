import {
  EAttachmentStore,
  pendingMessagesOf,
  pendingNoticesOf,
  type Attachment,
  type PendingInput,
  type PendingInputsState,
} from '@dltech/atlas-core'
import type { StagedInput } from '@dltech/atlas-client/stream'
import { queuedNoticeLineOf } from '@dltech/atlas-client/transcript'
import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
} from '@dltech/atlas-ui/ai/queued-messages'
import type { QueuedNotice } from '@dltech/atlas-ui/ai/queued-notices'

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
  id: string
  input: { text?: string | undefined; attachments?: readonly Attachment[] | undefined }
  urls: ReadonlyMap<string, string>
}): QueuedMessageEntry => ({
  id: args.id,
  text: args.input.text ?? '',
  attachments: attachmentsOf({ attachments: args.input.attachments, urls: args.urls }),
})

export const visibleQueuedOf = (args: {
  pending: PendingInputsState
  urls?: ReadonlyMap<string, string> | undefined
}): QueuedMessageEntry[] =>
  pendingOf(args.pending).map((input) =>
    entryOf({
      id: String(input.inboxId),
      input: input.message ?? { text: '' },
      urls: args.urls ?? NO_URLS,
    }),
  )

export const queuedNoticesOf = (pending: PendingInputsState): QueuedNotice[] =>
  pendingNoticesOf(pending).flatMap((input) => {
    const line = input.event === undefined ? undefined : queuedNoticeLineOf(input.event)
    return line === undefined ? [] : [{ id: String(input.inboxId), ...line }]
  })

export const stagedQueuedOf = (args: {
  staged: readonly StagedMessage[]
  urls?: ReadonlyMap<string, string> | undefined
}): QueuedMessageEntry[] =>
  args.staged.map((input) => entryOf({ id: input.clientId, input, urls: args.urls ?? NO_URLS }))

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`
