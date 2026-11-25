import {
  agentLabel,
  attachmentsOf,
  EAttachmentStore,
  oneLine,
  type Attachment,
  type SaidUpload,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'
import type { SaidImageWire } from '@dltech/atlas-wire/web'

export type RewindApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export type RewindKillRow = {
  kind: 'agent' | 'shell' | 'service'
  label: string
  running: boolean
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

export const seqByEventIdOf = (events: readonly RecordEvent[]): ReadonlyMap<string, number> =>
  new Map(events.flatMap((event) => (event.type === 'user-said' ? [[event.id, event.seq]] : [])))

export const rewoundMessageOf = (args: {
  events: readonly RecordEvent[]
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

const shellLabelOf = (event: { command: string; description?: string | undefined }): string =>
  event.description?.trim() || oneLine(event.command)

export const rewindKillsOf = (args: {
  events: readonly RecordEvent[]
  toSeq: number
}): readonly RewindKillRow[] => {
  const seeds = new Map<string, { kind: RewindKillRow['kind']; id: string; label: string }>()
  const running = new Set<string>()
  for (const event of args.events) {
    if (event.seq <= args.toSeq) continue
    switch (event.type) {
      case 'agent-spawned': {
        const key = `agent:${event.agentId}`
        seeds.set(key, {
          kind: 'agent',
          id: event.agentId,
          label: agentLabel({ agentType: event.agentType, intent: event.intent }),
        })
        running.add(key)
        break
      }
      case 'agent-ended':
        running.delete(`agent:${event.agentId}`)
        break
      case 'background-shell-started': {
        const key = `shell:${event.shellId}`
        seeds.set(key, { kind: 'shell', id: event.shellId, label: shellLabelOf(event) })
        running.add(key)
        break
      }
      case 'background-shell-ended':
        running.delete(`shell:${event.shellId}`)
        break
    }
  }
  return [...seeds.values()].map((seed) => ({
    kind: seed.kind,
    label: seed.label || seed.id,
    running: running.has(`${seed.kind}:${seed.id}`),
  }))
}

export const rewindLanded = (args: { events: readonly RecordEvent[]; eventId: string }): boolean =>
  !args.events.some((event) => event.id === args.eventId)

export const rewindRefused = (args: { events: readonly RecordEvent[]; inboxId: number }): boolean =>
  args.events.some((event) => event.type === 'input-refused' && event.inboxId === args.inboxId)

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
