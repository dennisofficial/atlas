import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageDraft,
  type QueuedMessageEntry,
  type QueuedMessageSave,
} from './queued-message-types'

const KILOBYTE = 1024
const MEGABYTE = KILOBYTE * 1024

export function formatSize(bytes: number): string {
  if (bytes < KILOBYTE) return `${bytes} B`
  if (bytes < MEGABYTE) return `${Math.round(bytes / KILOBYTE)} KB`
  return `${(bytes / MEGABYTE).toFixed(1)} MB`
}

export function isEmptyDraft({ text, attachments }: QueuedMessageDraft): boolean {
  return text.trim().length === 0 && attachments.length === 0
}

export function attachmentsFromFiles(files: File[]): QueuedAttachment[] {
  return files.map((file) => {
    const isImage = file.type.startsWith('image/')
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: isImage ? EQueuedAttachmentKind.Image : EQueuedAttachmentKind.File,
      previewUrl: isImage ? URL.createObjectURL(file) : undefined,
      size: file.size,
    }
  })
}

interface RemoveQueuedInput {
  queue: QueuedMessageEntry[]
  id: string
}

export function removeQueued({ queue, id }: RemoveQueuedInput): QueuedMessageEntry[] {
  return queue.filter((message) => message.id !== id)
}

interface SaveQueuedInput extends QueuedMessageSave {
  queue: QueuedMessageEntry[]
}

export function saveQueued({
  queue,
  id,
  text,
  attachments,
}: SaveQueuedInput): QueuedMessageEntry[] {
  if (isEmptyDraft({ text, attachments })) return removeQueued({ queue, id })
  return queue.map((message) =>
    message.id === id ? { ...message, text: text.trim(), attachments } : message,
  )
}
