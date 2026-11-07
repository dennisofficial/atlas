import {
  normalizedPrRepo,
  type BranchObservation,
  type EventDraft,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { PullRequestSource } from './ports'

const LOOKUP_TIMEOUT_MS = 10_000
const MAX_LOOKUPS_PER_TURN = 10

type PullRequestLinked = Extract<EventDraft, { type: 'pull-request-linked' }>

export type PrLinkRecorder = {
  append(args: { threadId: ThreadId; runId: RunId; body: PullRequestLinked }): Promise<unknown>
  lastObservation(repo: string): BranchObservation | undefined
  hasLink(args: { repo: string; branch: string }): boolean
}

export type PrLinkerArgs = {
  source: PullRequestSource
  record: PrLinkRecorder
  threadId: ThreadId
  signal: AbortSignal
  repos(): Promise<readonly string[]>
  runId(): RunId
  log?: LogPort | undefined
}

type Candidate = {
  repoPath: string
  repo: string
  branch: string
  sha: string
  worktree?: string | undefined
}

export class PrLinker {
  private readonly lookedUp = new Map<string, string>()

  constructor(private readonly args: PrLinkerArgs) {}

  async link(): Promise<void> {
    const candidates = await this.candidates()
    for (const candidate of candidates.slice(0, MAX_LOOKUPS_PER_TURN)) {
      if (this.args.signal.aborted) return
      await this.lookUp(candidate)
    }
  }

  private async candidates(): Promise<Candidate[]> {
    const found: Candidate[] = []
    for (const repoPath of await this.args.repos()) {
      const repo = this.args.source.repoOf(repoPath)
      const observation = this.args.record.lastObservation(repoPath)
      if (
        repo === null ||
        observation === undefined ||
        observation.base === undefined ||
        observation.base === null
      )
        continue
      for (const { name, sha } of observation.branches) {
        if (name === observation.base) continue
        if (this.lookedUp.get(keyOf({ repoPath, branch: name })) === sha) continue
        if (this.args.record.hasLink({ repo, branch: name })) continue
        const worktree = observation.worktrees.find((entry) => entry.branch === name)?.path
        found.push({ repoPath, repo, branch: name, sha, worktree })
      }
    }
    return found
  }

  private async lookUp(candidate: Candidate): Promise<void> {
    const { repoPath, repo, branch, sha, worktree } = candidate
    try {
      const signal = AbortSignal.any([this.args.signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)])
      const pull = await this.args.source.finder.find({ repo, branch, signal })
      this.lookedUp.set(keyOf({ repoPath, branch }), sha)
      if (pull === null) return
      await this.args.record.append({
        threadId: this.args.threadId,
        runId: this.args.runId(),
        body: {
          type: 'pull-request-linked',
          number: pull.number,
          url: pull.url,
          repo: normalizedPrRepo(repo),
          branch,
          ...(worktree === undefined ? {} : { worktreePath: worktree }),
        },
      })
    } catch (error) {
      this.args.log?.warn({
        source: 'holder.pr-links',
        message: `looking up the pull request of ${repo}:${branch} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}

const keyOf = (args: { repoPath: string; branch: string }): string =>
  `${args.repoPath}\u0000${args.branch}`
