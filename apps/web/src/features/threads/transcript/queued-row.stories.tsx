import {
  EAgentStatus,
  EAttachmentStore,
  EPrEventKind,
  EShellStatus,
  toThreadId,
  type Attachment,
  type EventBody,
  type PendingInputsState,
} from '@dltech/atlas-core'
import { ChatItem } from '@dltech/atlas-ui/ai/chat'

import { queuedRowsOf } from '@/features/sessions/data/queued-transcript'
import { ENoticeTone, ETranscriptKind } from '../data/transcript-items'
import type { NoticeItem } from '../data/transcript-notices'

import { QueuedRowItem } from './queued-row'
import { TranscriptNotice } from './transcript-notice'

const meta = {
  title: 'Threads/Queued rows',
  parameters: { layout: 'fullscreen' },
}

export default meta

const PR_COMMENT =
  'Dims the whole notice row, including the PR number and the file link, so both read as disabled text while the row is queued. The posted notice gets the same content once it lands, so the queued row should keep the title at full contrast and only the wrapper should carry the dim. Same for the CI row below it.'

const SHELL_OUTPUT = `apps/web/src/features/threads/__tests__/thread-transcript.spec.tsx:
(fail) ThreadTranscript queued rows > renders the queued rows after the running turn [1.20ms]
error: expect(received).toBeGreaterThan(expected)

Expected: > 4
Received: 3

 30 pass
 1 fail
Ran 31 tests across 1 file. [2.40s]`

const SCREENSHOT = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><rect width="360" height="200" fill="#27272a"/><rect x="12" y="12" width="336" height="24" rx="4" fill="#52525b"/><rect x="12" y="48" width="180" height="10" rx="3" fill="#71717a"/><rect x="12" y="72" width="336" height="116" rx="6" fill="#18181b"/><rect x="24" y="88" width="120" height="10" rx="3" fill="#a1a1aa"/><rect x="24" y="106" width="300" height="10" rx="3" fill="#3f3f46"/><rect x="24" y="124" width="264" height="10" rx="3" fill="#3f3f46"/><rect x="24" y="142" width="288" height="10" rx="3" fill="#3f3f46"/></svg>',
)}`

const at = '2026-11-23T10:04:00.000Z'

const input = (args: {
  inboxId: number
  kind: string
  event?: EventBody
  text?: string
  attachments?: readonly Attachment[]
}): PendingInputsState['pending'][number] => ({
  inboxId: args.inboxId,
  seq: args.inboxId,
  at,
  kind: args.kind,
  ...(args.event === undefined ? {} : { event: args.event }),
  ...(args.text === undefined
    ? {}
    : {
        message: {
          text: args.text,
          clientId: `client-${args.inboxId}`,
          ...(args.attachments === undefined ? {} : { attachments: args.attachments }),
        },
      }),
})

const prComment: EventBody = {
  type: 'pr-event',
  repo: 'dennisofficial/atlas',
  prNumber: 2617,
  kind: EPrEventKind.Comment,
  url: 'https://github.com/dennisofficial/atlas/pull/2617',
  authorLogin: 'claude',
  body: PR_COMMENT,
}

const ciRun: EventBody = {
  type: 'run-event',
  repo: 'dennisofficial/atlas',
  workflowRunId: 41297531108,
  workflow: 'CI',
  branch: 'dennis/queued-notices-in-transcript',
  url: 'https://github.com/dennisofficial/atlas/actions/runs/41297531108',
  status: 'completed',
  conclusion: 'failure',
  failedJobs: ['web / bun test'],
}

const shellEnded: EventBody = {
  type: 'background-shell-ended',
  shellId: 'shell-4',
  command: 'bun test src/features/threads',
  description: 'transcript specs',
  status: EShellStatus.Exited,
  exitCode: 1,
  output: SHELL_OUTPUT,
  droppedCharacters: 0,
  remainingCharacters: 0,
}

const agentEnded: EventBody = {
  type: 'agent-ended',
  agentId: toThreadId('agent-builder-1'),
  agentType: 'builder',
  intent: 'render queued rows through the posted notice component',
  status: EAgentStatus.Finished,
  prose:
    'Queued notices now go through noticeEntriesOf and noticeItemOf, so a queued row and the posted row cannot drift. The dim lives on one wrapper, opacity-45, and lifts on hover or focus so Edit and Remove stay legible.',
  turns: 6,
  toolCalls: 24,
}

const pending: PendingInputsState = {
  pending: [
    input({ inboxId: 11, kind: 'event', event: prComment }),
    input({ inboxId: 12, kind: 'event', event: ciRun }),
    input({ inboxId: 13, kind: 'event', event: shellEnded }),
    input({ inboxId: 14, kind: 'event', event: agentEnded }),
    input({
      inboxId: 15,
      kind: 'message',
      text: 'Dim the timestamp with the rest of the row, and keep the image thumbnail at full contrast in the posted message.',
      attachments: [
        {
          id: 'shot-1',
          name: 'queued-rows.png',
          mediaType: 'image/png',
          size: 284_112,
          content: { store: EAttachmentStore.Media, hash: 'shot-1' },
        },
      ],
    }),
  ],
}

const rooms = queuedRowsOf({
  pending,
  events: [],
  urls: new Map([['shot-1', SCREENSHOT]]),
})

const landedNotice: NoticeItem = {
  kind: ETranscriptKind.Notice,
  id: 'evt_120',
  title: 'PR #2617: claude approved',
  body: 'The queued row keeps the posted title and body, dimmed until it lands.',
  tone: ENoticeTone.Ok,
}

const noop = () => undefined

export const Queued = () => (
  <div className="flex flex-col">
    <ChatItem id="landed">
      <TranscriptNotice item={landedNotice} />
    </ChatItem>
    {rooms.map((row) => (
      <ChatItem key={row.id} id={row.id}>
        <QueuedRowItem row={row} author="Dennis" onOpenAgent={null} onEdit={noop} onRemove={noop} />
      </ChatItem>
    ))}
  </div>
)
