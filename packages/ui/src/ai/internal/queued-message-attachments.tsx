import { FileTextIcon, XIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '#components/attachment'
import { formatSize } from '../queued-message-ops'
import { EQueuedAttachmentKind, type QueuedAttachment } from '../queued-message-types'

interface ChipProps {
  attachment: QueuedAttachment
  onRemove?: (id: string) => void
}

function RemoveAction({ attachment, onRemove }: ChipProps) {
  if (!onRemove) return null
  const handleRemove = () => onRemove(attachment.id)
  return (
    <AttachmentActions>
      <AttachmentAction aria-label={`Remove ${attachment.name}`} onClick={handleRemove}>
        <XIcon />
      </AttachmentAction>
    </AttachmentActions>
  )
}

function ImageChip({ attachment, onRemove }: ChipProps) {
  return (
    <Attachment orientation="vertical">
      <AttachmentMedia variant="image">
        <img src={attachment.previewUrl} alt={attachment.name} />
      </AttachmentMedia>
      <RemoveAction attachment={attachment} onRemove={onRemove} />
    </Attachment>
  )
}

function FileChip({ attachment, onRemove }: ChipProps) {
  return (
    <Attachment size="sm">
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        {attachment.size === undefined ? null : (
          <AttachmentDescription>{formatSize(attachment.size)}</AttachmentDescription>
        )}
      </AttachmentContent>
      <RemoveAction attachment={attachment} onRemove={onRemove} />
    </Attachment>
  )
}

export interface QueuedMessageAttachmentsProps {
  attachments: QueuedAttachment[]
  onRemove?: (id: string) => void
}

export function QueuedMessageAttachments({ attachments, onRemove }: QueuedMessageAttachmentsProps) {
  if (attachments.length === 0) return null
  return (
    <AttachmentGroup className="flex-wrap">
      {attachments.map((attachment) =>
        attachment.kind === EQueuedAttachmentKind.Image && attachment.previewUrl ? (
          <ImageChip key={attachment.id} attachment={attachment} onRemove={onRemove} />
        ) : (
          <FileChip key={attachment.id} attachment={attachment} onRemove={onRemove} />
        ),
      )}
    </AttachmentGroup>
  )
}
