import { ENoticeTone, type EExecutionLocation, type Notice } from '@dltech/atlas-core'

import { CLOUD_LIFT_NOTICE_KEY } from '../../src/composition/cloud/lift-notices'

export type StepTiming = { step: string; elapsedMs: number }

export type CommandOutcome = { elapsedMs: number; timings: readonly StepTiming[] }

export type OwnerView = {
  subscribe: (listener: () => void) => () => void
  snapshot: () => { location: EExecutionLocation; bound: boolean; record: { move: unknown } | undefined }
}

export type NoticeView = {
  subscribe: (listener: () => void) => () => void
  current: () => readonly Notice[]
}

export enum ECommandWaitFailure {
  MoveFailed = 'move-failed',
  TimedOut = 'timed-out',
  Cancelled = 'cancelled',
}

export class CommandWaitError extends Error {
  readonly reason: ECommandWaitFailure
  readonly timings: readonly StepTiming[]

  constructor(args: { reason: ECommandWaitFailure; message: string; timings: readonly StepTiming[] }) {
    super(args.message)
    this.name = 'CommandWaitError'
    this.reason = args.reason
    this.timings = args.timings
  }
}

const MOVE_NOTICE_KEYS: readonly string[] = [CLOUD_LIFT_NOTICE_KEY, 'container-switch']

const MOVED_WITH_WARNING: readonly RegExp[] = [
  /^this conversation is in the cloud, but/,
  /^the session is home on the host, but/,
]

const NOTICE_TEXT_LIMIT = 500

export const moveFailureOf = (notice: Notice): string | undefined => {
  if (!MOVE_NOTICE_KEYS.includes(notice.key)) return undefined
  if (notice.tone !== ENoticeTone.Warn) return undefined
  if (MOVED_WITH_WARNING.some((pattern) => pattern.test(notice.text))) return undefined
  return notice.text.slice(0, NOTICE_TEXT_LIMIT)
}

const noticeIdentity = (notice: Notice): string => `${notice.key}@${notice.issuedAtMs}`

export type CommandWait = {
  start: () => void
  step: (step: string) => StepTiming | undefined
  dispose: () => void
  completion: Promise<CommandOutcome>
}

export function createCommandWait(args: {
  target: EExecutionLocation
  requiredSteps: readonly string[]
  owner: OwnerView
  notices: NoticeView
  failureOf: (notice: Notice) => string | undefined
  timeoutMs: number
  now?: (() => number) | undefined
}): CommandWait {
  const now = args.now ?? (() => performance.now())
  const timings: StepTiming[] = []
  const seen = new Set<string>()
  const standing = new Set<string>()
  let startedAt: number | undefined
  let settled = false
  let release: (() => void) | undefined

  let resolveCompletion: (outcome: CommandOutcome) => void = () => undefined
  let rejectCompletion: (error: CommandWaitError) => void = () => undefined
  const completion = new Promise<CommandOutcome>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  completion.catch(() => undefined)

  const missingSteps = (): string[] => args.requiredSteps.filter((step) => !seen.has(step))

  const ownerState = (): string => {
    const view = args.owner.snapshot()
    const move = view.record?.move == null ? 'none' : 'open'
    return `location=${view.location} bound=${view.bound} move=${move}`
  }

  const finish = (): void => {
    settled = true
    release?.()
    release = undefined
  }

  const fail = (failure: { reason: ECommandWaitFailure; message: string }): void => {
    if (settled) return
    finish()
    rejectCompletion(new CommandWaitError({ ...failure, timings: [...timings] }))
  }

  const owned = (): boolean => {
    const view = args.owner.snapshot()
    return view.location === args.target && view.bound && view.record?.move == null
  }

  const check = (): void => {
    if (settled || startedAt === undefined) return
    if (missingSteps().length > 0 || !owned()) return
    const elapsedMs = now() - startedAt
    finish()
    resolveCompletion({ elapsedMs, timings: [...timings] })
  }

  const checkNotices = (): void => {
    if (settled) return
    for (const notice of args.notices.current()) {
      if (standing.has(noticeIdentity(notice))) continue
      const failure = args.failureOf(notice)
      if (failure === undefined) continue
      fail({
        reason: ECommandWaitFailure.MoveFailed,
        message: `the move to ${args.target} failed: ${failure}`,
      })
      return
    }
  }

  const handleTimeout = (): void =>
    fail({
      reason: ECommandWaitFailure.TimedOut,
      message: [
        `timed out after ${args.timeoutMs} ms waiting for the move to ${args.target}`,
        `steps seen: ${[...seen].join(', ') || 'none'}`,
        `steps missing: ${missingSteps().join(', ') || 'none'}`,
        `owner: ${ownerState()}`,
      ].join('; '),
    })

  return {
    completion,

    start: () => {
      if (settled || startedAt !== undefined) return
      for (const notice of args.notices.current()) standing.add(noticeIdentity(notice))
      const unsubscribeOwner = args.owner.subscribe(check)
      const unsubscribeNotices = args.notices.subscribe(checkNotices)
      const timer = setTimeout(handleTimeout, args.timeoutMs)
      release = () => {
        clearTimeout(timer)
        unsubscribeOwner()
        unsubscribeNotices()
      }
      startedAt = now()
    },

    step: (step) => {
      if (settled || startedAt === undefined || seen.has(step)) return undefined
      seen.add(step)
      const timing = { step, elapsedMs: now() - startedAt }
      timings.push(timing)
      check()
      return timing
    },

    dispose: () =>
      fail({ reason: ECommandWaitFailure.Cancelled, message: 'the command wait was cancelled before it settled' }),
  }
}
