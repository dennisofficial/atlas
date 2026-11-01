import { db, or, type Tx } from '@dltech/atlas-db'

import type { PrTransitionSnapshot } from './github-pr-event-transitions'

export enum EHeadVerdict {
  Green = 'green',
  Failed = 'failed',
}

export type LockedPrState = {
  repoFullName: string
  prNumber: number
  state: string
  headSha: string
  headBranch: string
  headRepoFullName: string | null
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
}

export function verdictEventKeyOf(args: {
  repoFullName: string
  prNumber: number
  headSha: string
  verdict: EHeadVerdict
}): string {
  return `${args.repoFullName}:${args.prNumber}:${args.headSha}:verdict:${args.verdict}`
}

export function eventDedupeKeyOf(args: {
  repoFullName: string
  prNumber: number
  headSha: string
  kind: string
  verdictKey: string
  userId: string
}): string {
  return [
    args.repoFullName,
    args.prNumber,
    args.headSha,
    args.kind,
    args.verdictKey,
    args.userId,
  ].join(':')
}

/**
 * One transaction on the state row serializes concurrent writers (webhook fills and polls race
 * for the same PR), so the row-lock read below, the upsert, and the event inserts it gates on
 * all observe the same prior.
 */
export async function readPrStateForUpdate(args: {
  tx: Tx
  repoFullName: string
  prNumber: number
}): Promise<LockedPrState | null> {
  const rows = await args.tx.query(
    args.tx.sql.public.GithubPrState.select(
      'repoFullName',
      'prNumber',
      'state',
      'headSha',
      'headBranch',
      'headRepoFullName',
      'checksRunning',
      'checksPassed',
      'checksFailed',
      'mergeable',
    )
      .where((f, fns) =>
        fns.and(fns.eq(f.repoFullName, args.repoFullName), fns.eq(f.prNumber, args.prNumber)),
      )
      .forUpdate()
      .build(),
  )
  let found: LockedPrState | null = null
  for await (const row of rows) found = row
  return found
}

export function snapshotOfLocked(row: {
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
}): PrTransitionSnapshot {
  return {
    state: row.state,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    mergeable: row.mergeable,
  }
}

/**
 * The per-head verdict ledger: CI verdicts are obligations against a head SHA, not side effects
 * of one observed running→settled crossing. An observation that reads the head settled while the
 * ledger row has not announced that verdict owes one emission, however the checks got there — a
 * zero→green run on an unchanged SHA and a first observation of an already-green PR included. The
 * claim (`verdictEventId` set under the state row's transaction) commits with the mailbox insert,
 * so a crash between writes replays into the event's dedupe key and still announces exactly once
 * per (head, verdict, user); a verdict that flips after a check retry announces again under its
 * own key.
 */
export async function dischargeHeadVerdict(args: {
  tx: Tx | undefined
  repoFullName: string
  prNumber: number
  next: PrTransitionSnapshot
  now: Date
  emitVerdict: (verdict: EHeadVerdict, eventKey: string) => Promise<void>
}): Promise<void> {
  const running = args.next.checksRunning > 0
  const completed = args.next.checksPassed + args.next.checksFailed > 0
  const settled = !running && completed
  const orm = args.tx === undefined ? db.orm : args.tx.orm

  await orm.public.GithubPrHeadCheck.upsert({
    conflictOn: {
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      headSha: args.next.headSha,
    },
    create: {
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      headSha: args.next.headSha,
      firstSeenRunningAt: running ? args.now : null,
      settledAt: settled ? args.now : null,
      verdict: settled ? verdictOf(args.next) : null,
      verdictEventId: null,
    },
    update: running
      ? { firstSeenRunningAt: args.now }
      : settled
        ? { settledAt: args.now, verdict: verdictOf(args.next) }
        : {},
  })

  if (!settled) return
  const verdict = verdictOf(args.next)
  const eventKey = verdictEventKeyOf({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
    headSha: args.next.headSha,
    verdict,
  })
  const discharged = await orm.public.GithubPrHeadCheck.where({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
    headSha: args.next.headSha,
  })
    .where((row) => or(row.verdictEventId.isNull(), row.verdictEventId.neq(eventKey)))
    .updateAndCount({ verdictEventId: eventKey, verdict })
  if (discharged === 0) return
  await args.emitVerdict(verdict, eventKey)
}

/**
 * A merged PR whose head has a ledger row still owed a verdict (or no row at all — the head may
 * never have been observed settled) stays reconcilable: the refresh queue and check-webhook
 * targeting keep it until the verdict lands or the post-terminal window closes.
 */
export async function unsettledHeadExists(args: {
  repoFullName: string
  prNumber: number
  headSha: string
}): Promise<boolean> {
  const row = await db.orm.public.GithubPrHeadCheck.where({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
    headSha: args.headSha,
  }).first()
  if (row === null) return true
  return row.verdictEventId === null
}

function verdictOf(snapshot: PrTransitionSnapshot): EHeadVerdict {
  return snapshot.checksFailed > 0 ? EHeadVerdict.Failed : EHeadVerdict.Green
}
