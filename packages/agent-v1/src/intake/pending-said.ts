import type {
  EMessageOrigin,
  EventDraft,
  SaidFile,
  SaidImage,
  SaidUpload,
  Attachment,
} from '@dltech/atlas-core'

export type PendingSaid = {
  text: string
  images: readonly SaidImage[]
  files: readonly SaidFile[]
  uploads?: readonly SaidUpload[] | undefined
  attachments?: readonly Attachment[] | undefined
  context?: readonly EventDraft[] | undefined
  via?: EMessageOrigin | undefined
  requestId?: string | undefined
}

export type ExpandContext = (args: {
  text: string
  context: readonly EventDraft[]
}) => readonly EventDraft[]
