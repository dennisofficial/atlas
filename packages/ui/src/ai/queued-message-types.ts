export enum EQueuedAttachmentKind {
  Image = 'image',
  File = 'file',
}

export interface QueuedAttachment {
  id: string
  name: string
  kind: EQueuedAttachmentKind
  previewUrl?: string
  size?: number
}

export interface QueuedMessageEntry {
  id: string
  text: string
  attachments: QueuedAttachment[]
}

export interface QueuedMessageDraft {
  text: string
  attachments: QueuedAttachment[]
}

export interface QueuedMessageSave extends QueuedMessageDraft {
  id: string
}
