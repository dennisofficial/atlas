import { FileIcon, TriangleAlertIcon, XIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from '#components/attachment'

export enum EPromptAttachmentStatus {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
}

export interface PromptAttachment {
  id: string
  name: string
  previewUrl?: string | undefined
  status?: EPromptAttachmentStatus | undefined
  progress?: number | undefined
}

const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ProgressRing({ progress }: { progress: number }) {
  const filled = Math.min(1, Math.max(0, progress))
  return (
    <svg
      viewBox="0 0 24 24"
      role="progressbar"
      aria-label="Uploading"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(filled * 100)}
      className="absolute inset-0 m-auto size-6 -rotate-90 text-primary"
    >
      <circle
        cx="12"
        cy="12"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2.5"
        className="stroke-border"
      />
      <circle
        cx="12"
        cy="12"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - filled)}
      />
    </svg>
  )
}

export function PromptAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PromptAttachment
  onRemove?: (id: string) => void
}) {
  return (
    <Attachment
      size="xs"
      state={
        attachment.status === EPromptAttachmentStatus.Failed
          ? 'error'
          : attachment.status === EPromptAttachmentStatus.Uploading
            ? 'uploading'
            : 'done'
      }
      title={attachment.status === EPromptAttachmentStatus.Failed ? 'Upload failed' : undefined}
    >
      {attachment.previewUrl === undefined ? (
        <AttachmentMedia>
          {attachment.status === EPromptAttachmentStatus.Failed ? (
            <TriangleAlertIcon />
          ) : attachment.status === EPromptAttachmentStatus.Uploading ? (
            <ProgressRing progress={attachment.progress ?? 0} />
          ) : (
            <FileIcon />
          )}
        </AttachmentMedia>
      ) : (
        <AttachmentMedia variant="image">
          <img src={attachment.previewUrl} alt="" />
          {attachment.status === EPromptAttachmentStatus.Uploading ? (
            <ProgressRing progress={attachment.progress ?? 0} />
          ) : null}
        </AttachmentMedia>
      )}
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={`Remove ${attachment.name}`}
          onClick={() => onRemove?.(attachment.id)}
        >
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}
