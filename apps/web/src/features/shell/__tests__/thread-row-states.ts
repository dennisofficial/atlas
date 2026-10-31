import type { WireThread } from '@dltech/atlas-wire/web'

import { ELocalActivityState, type ThreadDisplay } from '@/features/threads/data/thread-display'

import { EThreadStatus } from '../thread-status'
import { threadOf } from './fixtures'

type Facts = NonNullable<WireThread['status']>

const facts = (overrides: Partial<Facts> = {}): Facts => ({
  working: false,
  awaiting: null,
  lastOutcome: null,
  podState: 'running',
  lastAssistantSeq: 0,
  readSeq: null,
  ...overrides,
})

const pr = (number: number, state: string) => ({
  number,
  url: `https://github.com/x/y/pull/${number}`,
  repo: 'x/y',
  branch: `b${number}`,
  state,
})

export interface ThreadRowState {
  thread: ThreadDisplay
  expected: EThreadStatus
  unread: boolean
}

const row = (args: {
  id: string
  title: string
  expected: EThreadStatus
  unread?: boolean
  status?: Partial<Facts>
  pullRequests?: WireThread['pullRequests']
}): ThreadRowState => ({
  thread: threadOf({
    id: args.id,
    title: args.title,
    status: facts({
      ...(args.unread === true ? { lastAssistantSeq: 5, readSeq: 2 } : {}),
      ...args.status,
    }),
    ...(args.pullRequests === undefined ? {} : { pullRequests: args.pullRequests }),
  }),
  expected: args.expected,
  unread: args.unread === true,
})

export const THREAD_ROW_STATES: ThreadRowState[] = [
  {
    thread: {
      ...threadOf({ id: 'unavailable', title: 'Activity unsupported' }),
      localAvailability: {
        activityState: ELocalActivityState.Unavailable,
        lastAssistantSeq: 5,
        readSeq: null,
        reason: 'Unsupported',
      },
    },
    expected: EThreadStatus.Unavailable,
    unread: true,
  },
  row({
    id: 'awaiting',
    title: 'Needs your approval',
    expected: EThreadStatus.Awaiting,
    status: { awaiting: 'approval', working: true },
  }),
  row({
    id: 'awaiting-input',
    title: 'Asked a question',
    expected: EThreadStatus.Awaiting,
    unread: true,
    status: { awaiting: 'input' },
  }),
  row({
    id: 'running',
    title: 'Refactor the router',
    expected: EThreadStatus.Running,
    status: { working: true },
  }),
  row({
    id: 'running-unread',
    title: 'Working with fresh output',
    expected: EThreadStatus.Running,
    status: { working: true, lastAssistantSeq: 5, readSeq: 2 },
  }),
  row({
    id: 'starting',
    title: 'Booting the pod',
    expected: EThreadStatus.Starting,
    status: { podState: 'booting' },
  }),
  row({
    id: 'failed-pod',
    title: 'Pod failed to boot',
    expected: EThreadStatus.Failed,
    status: { podState: 'failed' },
  }),
  row({
    id: 'failed-run',
    title: 'Last run failed',
    expected: EThreadStatus.Failed,
    unread: true,
    status: { lastOutcome: 'failed' },
  }),
  row({
    id: 'merged',
    title: 'Shipped the fix',
    expected: EThreadStatus.PrMerged,
    pullRequests: [pr(1, 'merged')],
  }),
  row({
    id: 'open',
    title: 'Review requested',
    expected: EThreadStatus.PrOpen,
    unread: true,
    pullRequests: [pr(2, 'open')],
  }),
  row({
    id: 'closed',
    title: 'Abandoned approach',
    expected: EThreadStatus.PrClosed,
    pullRequests: [pr(3, 'closed')],
  }),
  row({ id: 'idle', title: 'Quiet thread', expected: EThreadStatus.Idle }),
  row({
    id: 'idle-unread',
    title: 'Finished, not yet read',
    expected: EThreadStatus.Idle,
    unread: true,
    status: { lastOutcome: 'completed' },
  }),
  row({
    id: 'never-opened',
    title: 'Never opened by you',
    expected: EThreadStatus.Idle,
    status: { lastAssistantSeq: 3, readSeq: null },
    unread: true,
  }),
]
