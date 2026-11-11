import { describe, expect, it } from 'bun:test'

import { EReportKind } from '../../agents/report'
import { EAgentRestart } from '../../agents/restart'
import { ELane } from '../../context/envelope'
import { EContextSlot } from '../../context/slot'
import { EMessageOrigin, EPrEventKind, EPrVerdict } from '../../events/body'
import type { EventDraft } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import { ESubscriptionActor } from '../../subscriptions/subscription'
import { assemble } from '../assemble'
import { defaultRules } from '../pipeline'
import { EMPTY_PROMPT } from '../rules/system-prompt'
import { contextFor, log } from './log-fixture'

const PROJECT_DIRECTORY = '/w'

const RESERVED_TAGS: readonly string[] = Object.values(ELane)

const DRAFTS: readonly EventDraft[] = [
  { type: 'user-said', text: 'run the suite' },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'on it' }] },
  { type: 'user-said', text: 'count the callers', via: EMessageOrigin.PeerAgent },
  { type: 'user-said', text: 'a sub-agent line', via: EMessageOrigin.ChildAgent },
  { type: 'user-said', text: 'a sibling session line', sender: { session: 'ses_2' } },
  {
    type: 'context-loaded',
    slot: EContextSlot.ProjectInstructions,
    key: '/w/CLAUDE.md',
    content: 'be brief',
  },
  { type: 'nudge', text: 'keep going', lifetimeSteps: 3 },
  { type: 'sandbox-setup-reported', text: 'installed', failed: false },
  { type: 'worktree-entered', path: '/w/tree', branch: 'dennis/envelope' },
  {
    type: 'background-shell-ended',
    shellId: 'shell-1',
    command: 'bun test',
    status: EShellStatus.Exited,
    exitCode: 0,
    output: 'green',
    droppedCharacters: 0,
    remainingCharacters: 0,
  },
  {
    type: 'service-ended',
    serviceId: 'svc-1',
    command: 'bun dev',
    status: EServiceStatus.Exited,
    tail: 'done',
  },
  {
    type: 'pr-event',
    repo: 'github.com/owner/repo',
    prNumber: 12,
    kind: EPrEventKind.Verdict,
    url: 'https://example.com/pull/12',
    verdict: EPrVerdict.Green,
  },
  {
    type: 'run-event',
    repo: 'github.com/owner/repo',
    workflowRunId: 7,
    workflow: 'ci',
    branch: 'main',
    url: 'https://example.com/run/7',
    status: 'completed',
    conclusion: 'success',
  },
  {
    type: 'subscription-created',
    subscriptionId: 'sub-1',
    provider: 'github.pull-request',
    target: { number: 7 },
    label: 'PR #7',
    createdBy: ESubscriptionActor.Operator,
  },
  {
    type: 'agent-reported',
    agentId: toThreadId('thread-child'),
    agentType: 'explore',
    intent: 'find the callers',
    prose: 'three callers',
    kind: EReportKind.Done,
  },
  {
    type: 'agent-restarted',
    agentId: toThreadId('thread-child'),
    agentType: 'explore',
    intent: 'find the callers',
    via: EAgentRestart.Message,
  },
]

const userTexts = (): readonly string[] => {
  const { assembled } = assemble({
    rules: defaultRules({
      prompt: () => EMPTY_PROMPT,
      launchDirectory: PROJECT_DIRECTORY,
    }),
    ctx: contextFor({ events: log(DRAFTS) }),
  })

  return assembled.messages
    .flatMap((entry) => (entry.message.role === 'user' ? entry.message.content : []))
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
}

const startsWithReservedTag = (text: string): boolean =>
  RESERVED_TAGS.some((tag) => text.startsWith(`<${tag}`))

describe('every assembly rule runs its text through an envelope', () => {
  it('opens each user message part with a reserved tag', () => {
    const texts = userTexts()

    expect(texts.length).toBeGreaterThan(5)
    expect(texts.filter((text) => !startsWithReservedTag(text))).toEqual([])
  })

  it('keeps assistant text bare, because the model wrote it', () => {
    const { assembled } = assemble({
      rules: defaultRules({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
      ctx: contextFor({ events: log(DRAFTS) }),
    })

    const assistant = assembled.messages
      .flatMap((entry) => (entry.message.role === 'assistant' ? entry.message.content : []))
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))

    expect(assistant).toEqual(['on it'])
  })
})
