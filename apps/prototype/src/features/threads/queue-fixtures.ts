import { EQueuedAttachmentKind, type QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'

const SCREENSHOT =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Crect width='160' height='160' fill='%23374151'/%3E%3Crect x='16' y='20' width='128' height='22' rx='4' fill='%236b7280'/%3E%3Crect x='16' y='74' width='128' height='70' rx='6' fill='%231f2937'/%3E%3C/svg%3E"

export const MAX_QUEUED = 5

const QUEUE_POOL: QueuedMessageEntry[] = [
  {
    id: 'q1',
    text: 'Also bump the storybook addon versions while you are in there',
    attachments: [],
  },
  { id: 'q2', text: 'Squash the commits before opening the PR', attachments: [] },
  {
    id: 'q3',
    text: 'The sidebar spacing looks off compared to this mock, can you match it?',
    attachments: [
      {
        id: 'q3-img',
        name: 'sidebar-mock.png',
        kind: EQueuedAttachmentKind.Image,
        previewUrl: SCREENSHOT,
        size: 184_320,
      },
      {
        id: 'q3-pdf',
        name: 'spacing-spec.pdf',
        kind: EQueuedAttachmentKind.File,
        size: 1_245_184,
      },
    ],
  },
  { id: 'q4', text: 'Add a changeset for the ui package', attachments: [] },
  { id: 'q5', text: 'Ping me in Slack when the preview is live', attachments: [] },
]

export function queueOf(count: number): QueuedMessageEntry[] {
  return QUEUE_POOL.slice(0, Math.min(MAX_QUEUED, Math.max(0, count)))
}
