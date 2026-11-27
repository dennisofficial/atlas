import { db, or, type Row, type Tx } from '@dltech/atlas-db'

import { headSettled, type PrTransitionSnapshot } from './github-pr-event-transitions'

export enum EHeadVerdict {
  Green = 'green',
  Failed = 'failed',
}

export function verdictEventKeyOf(args: {
  repoFullName: string
  prNumber: number
  headSha: string
  verdict: EHeadVerdict
  settlement: string
}): string {
  return `${args.repoFullName}:${args.prNumber}:${args.headSha}:verdict:${args.verdict}:${args.settlement}`
}

export function snapshotOfLocked(row: {
  state: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  checksIgnored: number
  mergeable: boolean | null
  mergeClean: boolean | null
}): PrTransitionSnapshot {
  return {
    state: row.state,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    checksIgnored: row.checksIgnored,
    mergeable: row.mergeable,
    mergeClean: row.mergeClean,
  }
}

/**
 * The observed row plus the base branch's required status checks GitHub has not reported on this
 * head yet. Every path that discharges a verdict or diffs a transition builds its `next` here, so
 * a missing required check gates all of them.
 */
export function settlementSnapshotOf(args: {
  row: Row<'GithubPrState'>
  missingRequiredChecks: number
}): PrTransitionSnapshot {
  return { ...snapshotOfLocked(args.row), missingRequiredChecks: args.missingRequiredChecks }
}

export type HeadVerdictLedger = Row<'GithubPrHeadCheck'>

const ledgerKeyOf = (args: { repoFullName: string; prNumber: number; headSha: string }) => ({
  repoFullName: args.repoFullName,
  prNumber: args.prNumber,
  headSha: args.headSha,
})

const settledEventKeyOf = (args: {
  repoFullName: string
  prNumber: number
  ledger: HeadVerdictLedger
  verdict: EHeadVerdict
}): string =>
  verdictEventKeyOf({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
    headSha: args.ledger.headSha,
    verdict: args.verdict,
    settlement: args.ledger.firstSeenRunningAt?.getTime().toString() ?? 'none',
  })

function restartsAnnouncedVerdict(prior: HeadVerdictLedger | null): prior is HeadVerdictLedger & {
  verdictEventId: string
} {
  if (prior === null || prior.verdictEventId === null || prior.settledAt === null) return false
  const runningSince = prior.firstSeenRunningAt
  return runningSince === null || runningSince.getTime() <= prior.settledAt.getTime()
}

export const restartEventKeyOf = (announcedVerdictKey: string): string =>
  `${announcedVerdictKey}:restarted`

/**
 * The per-head verdict ledger: CI verdicts are obligations against a head SHA, not side effects
 * of one observed running→settled crossing. An observation that reads the head settled while the
 * ledger row has not announced that verdict owes one emission, however the checks got there — a
 * zero→green run on an unchanged SHA and a first observation of an already-green PR included. The
 * claim (`verdictEventId` set under the state row's transaction) commits with the mailbox insert,
 * so a crash between writes replays into the event's dedupe key and still announces exactly once
 * per (head, verdict, user); a verdict that flips after a check retry announces again under its
 * own key. A green verdict is held until a read of the head's check suites outside the lock shows
 * no queued workflow, because a queued workflow has no check run yet and so cannot hold the tally
 * open. A running observation after an announced verdict owes one restart notice.
 */
export async function dischargeHeadVerdict(args: {
  tx: Tx | undefined
  repoFullName: string
  prNumber: number
  next: PrTransitionSnapshot
  now: Date
  emitVerdict: (verdict: EHeadVerdict, eventKey: string) => Promise<void>
  holdGreen: (eventKey: string) => Promise<void>
  announceRestart: (eventKey: string) => Promise<void>
}): Promise<void> {
  const running = args.next.checksRunning > 0
  const settled = headSettled(args.next)
  const orm = args.tx === undefined ? db.orm : args.tx.orm
  const key = ledgerKeyOf({ ...args, headSha: args.next.headSha })
  const prior = running ? await orm.public.GithubPrHeadCheck.where(key).first() : null

  const ledger = await orm.public.GithubPrHeadCheck.upsert({
    conflictOn: key,
    create: {
      ...key,
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

  if (restartsAnnouncedVerdict(prior)) {
    await args.announceRestart(restartEventKeyOf(prior.verdictEventId))
  }
  if (!settled) return
  const verdict = verdictOf(args.next)
  const eventKey = settledEventKeyOf({ ...args, ledger, verdict })
  if (ledger.verdictEventId === eventKey) return
  if (verdict === EHeadVerdict.Green) {
    await args.holdGreen(eventKey)
    return
  }
  if (!(await claimVerdict({ orm, key, eventKey, verdict }))) return
  await args.emitVerdict(verdict, eventKey)
}

async function claimVerdict(args: {
  orm: Tx['orm']
  key: ReturnType<typeof ledgerKeyOf>
  eventKey: string
  verdict: EHeadVerdict
}): Promise<boolean> {
  const discharged = await args.orm.public.GithubPrHeadCheck.where(args.key)
    .where((row) => or(row.verdictEventId.isNull(), row.verdictEventId.neq(args.eventKey)))
    .updateAndCount({ verdictEventId: args.eventKey, verdict: args.verdict })
  return discharged > 0
}

export async function heldGreenOwed(args: {
  tx?: Tx
  repoFullName: string
  prNumber: number
  headSha: string
  eventKey: string
}): Promise<boolean> {
  const ledger = await (args.tx ?? db).orm.public.GithubPrHeadCheck.where(ledgerKeyOf(args)).first()
  if (ledger === null || ledger.verdict !== EHeadVerdict.Green) return false
  if (ledger.verdictEventId === args.eventKey) return false
  return settledEventKeyOf({ ...args, ledger, verdict: EHeadVerdict.Green }) === args.eventKey
}

export async function dischargeHeldGreen(args: {
  tx: Tx
  repoFullName: string
  prNumber: number
  next: PrTransitionSnapshot
  eventKey: string
  emitVerdict: (verdict: EHeadVerdict, eventKey: string) => Promise<void>
}): Promise<void> {
  if (!headSettled(args.next) || verdictOf(args.next) !== EHeadVerdict.Green) return
  const key = ledgerKeyOf({ ...args, headSha: args.next.headSha })
  if (!(await heldGreenOwed({ ...key, tx: args.tx, eventKey: args.eventKey }))) return
  const verdict = EHeadVerdict.Green
  if (!(await claimVerdict({ orm: args.tx.orm, key, eventKey: args.eventKey, verdict }))) return
  await args.emitVerdict(verdict, args.eventKey)
}

/**
 * A merged PR whose head has a ledger row still owed a verdict (or no row at all — the head may
 * never have been observed settled) stays reconcilable: the refresh queue and check-webhook
 * targeting keep it until the verdict lands or the post-terminal window closes.
 */
export async function unsettledHeadExists(args: {
  tx?: Tx
  repoFullName: string
  prNumber: number
  headSha: string
}): Promise<boolean> {
  const row = await (args.tx ?? db).orm.public.GithubPrHeadCheck.where({
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
