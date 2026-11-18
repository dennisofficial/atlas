import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import type { Logger } from '@nestjs/common'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { ThreadChangedSignal } from '../../platform/sessions/thread-signal.bus'
import type { PrKeyWatch } from './github-pr-fanout.watchers'
import type { GithubPrFanoutService } from './github-pr-fanout.service'
import { ELinkedPrAccess, type LinkedPrAccess } from './github-linked-pr-access'
import { cachedPrStates, type LinkedPr, linkedPrs } from './github-linked-prs'
import { normalizedRepo, prIdentity } from './github-pr-identity'
import type { PrFrameSink } from './github-pr-stream.frames'
import { ACCESS_PROOF_RECHECK_MS } from './github-request-coordinator.types'
import type { GithubPrStateDto } from './github-realtime.types'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

export const PR_STATES_HEARTBEAT_MS = 30_000
export const LINKED_PR_PENDING_RETRY_MS = 60_000

type PrRef = { repoFullName: string; prNumber: number }

const isValidRepo = (repoFullName: string): boolean => /^[\w.-]+\/[\w.-]+$/.test(repoFullName)

const prOf = (link: { repo: string; number: number }): PrRef | undefined => {
  const repoFullName = normalizedRepo(link.repo)
  if (!isValidRepo(repoFullName)) return undefined
  if (!Number.isSafeInteger(link.number) || link.number < 1) return undefined
  return { repoFullName, prNumber: link.number }
}

const groupedByRepo = (prs: readonly PrRef[]): Map<string, PrRef[]> => {
  const byRepo = new Map<string, PrRef[]>()
  for (const pr of prs) {
    const held = byRepo.get(pr.repoFullName)
    if (held === undefined) byRepo.set(pr.repoFullName, [pr])
    else held.push(pr)
  }
  return byRepo
}

export function attachPrStates(args: {
  userId: string
  signal?: AbortSignal | undefined
  sink: PrFrameSink<GithubPrStatesFrame>
  fanout: GithubPrFanoutService
  subscriptions: GithubSubscriptionsService
  access: LinkedPrAccess
  signals: ThreadSignalsService
  logger: Logger
}): () => void {
  const seen = new Map<string, number>()
  const verdicts = new Map<string, ELinkedPrAccess>()
  const linked = new Map<string, PrRef>()
  const known = new Map<string, PrRef[]>()
  let disposed = false
  let pendingRetry: ReturnType<typeof setTimeout> | undefined

  const push = (state: GithubPrStateDto): void => {
    const key = prIdentity(state)
    const held = seen.get(key)
    if (held !== undefined && state.version <= held) return
    seen.set(key, state.version)
    args.sink.push({ type: EGithubPrStatesFrame.PrState, state })
  }

  const watch: PrKeyWatch = args.fanout.watchPrKeys({
    handler: push,
    onClosed: () => args.sink.close(),
  })

  const allow = async (repoFullName: string): Promise<boolean> => {
    const held = verdicts.get(repoFullName)
    if (held !== undefined) return held === ELinkedPrAccess.Allowed
    const verdict = await args.access.check({ userId: args.userId, repoFullName })
    verdicts.set(repoFullName, verdict)
    return verdict === ELinkedPrAccess.Allowed
  }

  const hold = (prs: readonly PrRef[]): number => {
    let added = 0
    for (const pr of prs) {
      const key = prIdentity(pr)
      if (linked.has(key)) continue
      linked.set(key, pr)
      added += 1
    }
    if (added > 0) watch.setKeys([...linked.keys()])
    return added
  }

  const replay = async (prs: readonly PrRef[]): Promise<void> => {
    if (prs.length === 0) return
    const states = await cachedPrStates(prs)
    if (disposed) return
    for (const state of states) push(state)
  }

  const remember = (args: { repoFullName: string; prs: readonly PrRef[] }): void => {
    const held = new Map((known.get(args.repoFullName) ?? []).map((pr) => [prIdentity(pr), pr]))
    for (const pr of args.prs) held.set(prIdentity(pr), pr)
    known.set(args.repoFullName, [...held.values()])
  }

  const retryPendingLater = (): void => {
    if (disposed || pendingRetry !== undefined) return
    if (![...verdicts.values()].includes(ELinkedPrAccess.Pending)) return
    pendingRetry = setTimeout(() => {
      pendingRetry = undefined
      void retryPending()
    }, LINKED_PR_PENDING_RETRY_MS)
  }

  const retryPending = async (): Promise<void> => {
    const pending = [...verdicts].filter(([, verdict]) => verdict === ELinkedPrAccess.Pending)
    for (const [repoFullName] of pending) {
      const verdict = await args.access.check({ userId: args.userId, repoFullName })
      if (disposed) return
      verdicts.set(repoFullName, verdict)
      if (verdict !== ELinkedPrAccess.Allowed) continue
      hold(known.get(repoFullName) ?? [])
      await replay(known.get(repoFullName) ?? [])
    }
    if (disposed) return
    retryPendingLater()
  }

  const addLinked = async (prs: readonly PrRef[]): Promise<void> => {
    const fresh = prs.filter((pr) => !linked.has(prIdentity(pr)))
    for (const [repoFullName, ofRepo] of groupedByRepo(fresh)) {
      remember({ repoFullName, prs: ofRepo })
      if (!(await allow(repoFullName))) continue
      if (disposed) return
      hold(ofRepo)
      await replay(ofRepo)
      if (disposed) return
    }
    retryPendingLater()
  }

  const handleThreadChanged = (signal: ThreadChangedSignal): void => {
    if (disposed) return
    const linkedNow = (signal.thread.pullRequests ?? [])
      .map((link) => prOf({ repo: link.repo, number: link.number }))
      .filter((pr): pr is PrRef => pr !== undefined)
      .filter((pr) => !linked.has(prIdentity(pr)))
    if (linkedNow.length === 0) return
    void addLinked(linkedNow).catch((failure: unknown) =>
      args.logger.warn(`adding a linked PR named by a thread change failed: ${String(failure)}`),
    )
  }

  const handleConnect = async (): Promise<void> => {
    try {
      const states = await args.subscriptions.currentStates({ userId: args.userId })
      if (disposed) return
      for (const state of states) push(state)
    } catch (failure) {
      args.logger.warn(`replaying subscribed PR states failed: ${String(failure)}`)
    }
    try {
      const prs = await linkedPrs({ userId: args.userId })
      if (disposed) return
      await addLinked(prs)
    } catch (failure) {
      args.logger.warn(`replaying linked PR states failed: ${String(failure)}`)
    }
  }

  const recheckAccess = async (): Promise<void> => {
    if (disposed || linked.size === 0) return
    for (const repoFullName of [...new Set([...linked.values()].map((pr) => pr.repoFullName))]) {
      const verdict = await args.access.check({ userId: args.userId, repoFullName })
      if (disposed) return
      verdicts.set(repoFullName, verdict)
      if (verdict !== ELinkedPrAccess.Denied) continue
      for (const [key, pr] of linked) if (pr.repoFullName === repoFullName) linked.delete(key)
    }
    watch.setKeys([...linked.keys()])
  }

  args.sink.push({ type: EGithubPrStatesFrame.Heartbeat })
  const closeStream = args.fanout.openStream({
    userId: args.userId,
    handler: push,
    onClosed: () => args.sink.close(),
  })
  const unwatchThreads = args.signals.watchThreadChanges({
    userId: args.userId,
    onChanged: handleThreadChanged,
  })
  void handleConnect()
  const heartbeat = setInterval(() => {
    args.sink.push({ type: EGithubPrStatesFrame.Heartbeat })
  }, PR_STATES_HEARTBEAT_MS)
  const recheck = setInterval(() => {
    void recheckAccess().catch((failure: unknown) =>
      args.logger.warn(`re-checking linked PR access failed: ${String(failure)}`),
    )
  }, ACCESS_PROOF_RECHECK_MS)

  const detach = (): void => {
    if (disposed) return
    disposed = true
    clearInterval(heartbeat)
    clearInterval(recheck)
    if (pendingRetry !== undefined) clearTimeout(pendingRetry)
    unwatchThreads()
    watch.close()
    closeStream()
    args.signal?.removeEventListener('abort', detach)
  }
  args.signal?.addEventListener('abort', detach, { once: true })
  if (args.signal?.aborted === true) detach()
  return detach
}

export type { LinkedPr }
