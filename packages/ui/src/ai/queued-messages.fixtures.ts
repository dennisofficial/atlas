import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
} from './queued-message-types'

interface PlaceholderInput {
  hue: number
  label: string
}

function placeholderImage({ hue, label }: PlaceholderInput): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="hsl(${hue} 35% 30%)"/><rect x="16" y="20" width="128" height="22" rx="4" fill="hsl(${hue} 35% 45%)"/><rect x="16" y="74" width="128" height="70" rx="6" fill="hsl(${hue} 30% 22%)"/><text x="24" y="116" font-size="14" fill="white" font-family="sans-serif">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const SCREENSHOTS: QueuedAttachment[] = [
  {
    id: 'img1',
    name: 'before.png',
    kind: EQueuedAttachmentKind.Image,
    previewUrl: placeholderImage({ hue: 210, label: 'before' }),
    size: 184_320,
  },
  {
    id: 'img2',
    name: 'after.png',
    kind: EQueuedAttachmentKind.Image,
    previewUrl: placeholderImage({ hue: 150, label: 'after' }),
    size: 201_728,
  },
]

export const SPEC_PDF: QueuedAttachment = {
  id: 'pdf1',
  name: 'queue-design-spec.pdf',
  kind: EQueuedAttachmentKind.File,
  size: 1_245_184,
}

export const TWO_QUEUED: QueuedMessageEntry[] = [
  { id: 'q1', text: 'Also rename the Inactive bucket to Idle for 72h', attachments: [] },
  { id: 'q2', text: 'Squash the commits before opening the PR', attachments: [] },
]

export const WITH_IMAGES: QueuedMessageEntry[] = [
  {
    id: 'w1',
    text: 'The spacing on the left looks off compared to the mock, can you match it?',
    attachments: SCREENSHOTS,
  },
]

export const FILE_ONLY: QueuedMessageEntry[] = [{ id: 'f1', text: '', attachments: [SPEC_PDF] }]

export const MANY_QUEUED: QueuedMessageEntry[] = Array.from({ length: 8 }, (_, index) => ({
  id: `m${index}`,
  text:
    index === 2
      ? 'When you get to the legacy home page removal, check whether anything still links to it, including the sitemap, the footer, and the onboarding emails, and redirect those instead of deleting them outright'
      : `Queued follow-up number ${index + 1}`,
  attachments: [],
}))
