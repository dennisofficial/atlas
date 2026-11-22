import {
  checkoutsOf,
  commandEntriesOf,
  deriveStatus,
  meterOf,
  messageAfterFailureOf,
  runningCommandEntriesOf,
  type SpendTally,
} from '@dltech/atlas-core'
import {
  ECommandState,
  QUEUED_MESSAGES_LIMIT,
  type SessionCommandRow,
  type SessionStatusOutput,
  type SessionViewOutput,
} from '@dltech/atlas-protocol'

import type { SessionWindow } from './session-window'

export type FrameFacts = {
  lease: SessionStatusOutput['lease']
  spendTally: SpendTally
  pullRequests: SessionViewOutput['pullRequests']
  subscriptions: SessionViewOutput['subscriptions']
  pod: SessionStatusOutput['pod']
  sandbox: SessionStatusOutput['sandbox']
  sandboxProvider: SessionStatusOutput['sandboxProvider']
  credentialSource: SessionStatusOutput['credentialSource']
}

export const EMPTY_SPEND_TALLY: SpendTally = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  uncachedInputTokens: 0,
  costUsd: null,
}

export const EMPTY_FRAME_FACTS: FrameFacts = {
  lease: { epoch: 0, holderHostId: null, live: false },
  spendTally: EMPTY_SPEND_TALLY,
  pullRequests: [],
  subscriptions: [],
  pod: undefined,
  sandbox: undefined,
  sandboxProvider: undefined,
  credentialSource: undefined,
}

export const frameFactsOf = (view: SessionViewOutput): FrameFacts => ({
  lease: view.status.lease,
  spendTally: view.spend.tally,
  pullRequests: view.pullRequests,
  subscriptions: view.subscriptions,
  pod: view.status.pod,
  sandbox: view.status.sandbox,
  sandboxProvider: view.status.sandboxProvider,
  credentialSource: view.status.credentialSource,
})

const commandsOf = (window: SessionWindow): SessionCommandRow[] => {
  const running: SessionCommandRow[] = runningCommandEntriesOf(window.commandLog).map((entry) => ({
    ...entry,
    state: ECommandState.Running,
  }))
  const queued: SessionCommandRow[] = commandEntriesOf(window.pending).map((entry) => ({
    ...entry,
    state: ECommandState.Queued,
  }))
  return [...running, ...queued].slice(0, QUEUED_MESSAGES_LIMIT)
}

export const deriveStatusOf = (args: {
  window: SessionWindow
  frame: FrameFacts
  now: number
}): SessionStatusOutput => {
  const status = deriveStatus({
    facts: args.window.view.facts,
    live: args.frame.lease.live,
    queuedSince: null,
    pending: args.window.pending,
    messageAfterFailure: messageAfterFailureOf(args.window.failureMessage),
    now: new Date(args.now).toISOString(),
  })
  const commands = commandsOf(args.window)
  return {
    state: status.state,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
    ...(status.since === undefined ? {} : { since: status.since }),
    lease: args.frame.lease,
    ...(args.frame.sandbox == null ? {} : { sandbox: args.frame.sandbox }),
    ...(args.frame.sandboxProvider === undefined
      ? {}
      : { sandboxProvider: args.frame.sandboxProvider }),
    ...(args.frame.credentialSource === undefined
      ? {}
      : { credentialSource: args.frame.credentialSource }),
    ...(commands.length === 0 ? {} : { commands }),
    ...(args.frame.pod === undefined ? {} : { pod: args.frame.pod }),
  }
}

const checkoutsOutOf = (window: SessionWindow): SessionViewOutput['checkouts'] => {
  const checkouts = checkoutsOf(window.view.checkouts)
  return {
    repos: checkouts.repos.map((repo) => ({ ...repo, branches: [...repo.branches] })),
    primary: checkouts.primary,
  }
}

export const deriveViewOf = (args: {
  window: SessionWindow
  frame: FrameFacts
  now: number
}): SessionViewOutput => ({
  at: args.window.cursor?.seq ?? 0,
  status: deriveStatusOf(args),
  context: meterOf(args.window.view.meter),
  spend: { rows: [...args.window.view.spend.rows], tally: args.frame.spendTally },
  compute: { costUsd: null, running: false, tick: null },
  checkouts: checkoutsOutOf(args.window),
  pullRequests: args.frame.pullRequests,
  subscriptions: args.frame.subscriptions,
  pluginViews: args.window.view.pluginViews,
})

export type DerivedView = {
  status: SessionStatusOutput | undefined
  view: SessionViewOutput | undefined
}

export const derivedViewOf = (args: {
  window: SessionWindow
  frame: FrameFacts
  now: number
}): DerivedView => {
  if (args.window.cursor === undefined) return { status: undefined, view: undefined }
  const view = deriveViewOf(args)
  return { status: view.status, view }
}

export const retryDeadlineMsOf = (window: SessionWindow, now: number): number | undefined => {
  const due = window.view.facts.retries
    .map((retry) => Date.parse(retry.notBefore))
    .filter((ms) => Number.isFinite(ms) && ms > now)
    .sort((a, b) => a - b)
  return due[0]
}
