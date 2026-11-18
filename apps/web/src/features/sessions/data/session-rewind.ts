import {
  attachmentsOf,
  EAttachmentStore,
  type Attachment,
  type SaidUpload,
  type V2Event,
} from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'
import type { SaidImageWire } from '@dltech/atlas-wire/web'

export type RewindApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export type RewoundMessage = {
  eventId: string
  toSeq: number
  text: string
  attachments: readonly Attachment[]
}

export type RestoredMedia = {
  hash: string
  name: string
  mediaType: string
  size: number
  inline?: string | undefined
}

export type RestorePlan = {
  media: RestoredMedia[]
  uploads: SaidUpload[]
  images: SaidImageWire[]
}

export const seqByEventIdOf = (events: readonly V2Event[]): ReadonlyMap<string, number> =>
  new Map(events.flatMap((event) => (event.type === 'user-said' ? [[event.id, event.seq]] : [])))

export const rewoundMessageOf = (args: {
  events: readonly V2Event[]
  eventId: string
}): RewoundMessage | undefined => {
  const picked = args.events.find((event) => event.id === args.eventId)
  if (picked?.type !== 'user-said') return undefined
  return {
    eventId: picked.id,
    toSeq: picked.seq,
    text: picked.text,
    attachments: attachmentsOf(picked),
  }
}

/**
 * The client window drops hidden events, the history-rewound marker included, so the rewind shows
 * up only as the picked message leaving the window.
 */
export const rewindLanded = (args: { events: readonly V2Event[]; eventId: string }): boolean =>
  !args.events.some((event) => event.id === args.eventId)

export const rewindRefused = (args: { events: readonly V2Event[]; inboxId: number }): boolean =>
  args.events.some((event) => event.type === 'input-refused' && event.inboxId === args.inboxId)

/** A rewind never throws away what the operator already typed: the rewound message leads it. */
export const mergedDraftOf = (args: { rewound: string; current: string }): string => {
  if (args.current.trim() === '') return args.rewound
  if (args.rewound.trim() === '') return args.current
  return `${args.rewound}\n\n${args.current}`
}

export const restorePlanOf = (attachments: readonly Attachment[]): RestorePlan => {
  const plan: RestorePlan = { media: [], uploads: [], images: [] }
  for (const attachment of attachments) {
    const { content, name, mediaType, size } = attachment
    if (content.store === EAttachmentStore.Media) {
      plan.media.push({ hash: content.hash, name, mediaType, size, inline: content.inline })
      continue
    }
    const image = (data: string): SaidImageWire => ({
      path: name,
      mediaType,
      data,
      ...(attachment.image?.width === undefined ? {} : { width: attachment.image.width }),
      ...(attachment.image?.height === undefined ? {} : { height: attachment.image.height }),
    })
    if (content.store === EAttachmentStore.Upload) {
      plan.uploads.push({
        uploadId: content.uploadId,
        pathname: content.pathname,
        name,
        size,
        mediaType,
      })
      if (content.inline !== undefined) plan.images.push(image(content.inline))
      continue
    }
    plan.images.push(image(content.data))
  }
  return plan
}

export const requestRewind = async ({
  api,
  sessionId,
  toSeq,
}: {
  api: RewindApi
  sessionId: string
  toSeq: number
}): Promise<number> => {
  const { inboxId } = await api.command({ sessionId, name: 'rewind', args: { toSeq } })
  if (inboxId === undefined) throw new Error('rewind was not queued')
  return inboxId
}
