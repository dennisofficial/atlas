import { basename } from 'node:path'

import type { LogPort } from '@dltech/atlas-core'

import {
  EForge,
  EPullRequestLookup,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'
import { parseGhPullRequest } from './parse-gh-pull-request'
import { ESpawnFailure, spawnCommand, type CommandRun, type CommandRunner } from './run-command'

export enum EGhPollRole {
  FailoverFallback = 'failover-fallback',
  SignedOut = 'signed-out',
}

export enum EGhCallKind {
  Checkout = 'checkout',
  Linked = 'linked',
}

enum EGhCallOutcome {
  Found = 'found',
  Absent = 'absent',
  Unavailable = 'unavailable',
}

export const GH_CALL_LOG_SOURCE = 'github.gh-call'

export const GH_TIMEOUT_MS = 10_000

const GH_VIEW_FIELDS =
  'number,state,isDraft,url,headRefOid,statusCheckRollup,title,mergeable,comments,reviews'

export const GH_PULL_REQUEST_ARGV = ['gh', 'pr', 'view', '--json', GH_VIEW_FIELDS] as const

const linkedArgv = (args: { repo: string; number: number }): readonly string[] => [
  'gh',
  'pr',
  'view',
  String(args.number),
  '--repo',
  args.repo,
  '--json',
  GH_VIEW_FIELDS,
]

/** `gh help exit-codes`: 0 ok, 1 error, 2 cancelled, 4 authentication required. */
const GH_AUTH_REQUIRED = 4

const NO_PULL_REQUEST_STDERR = 'no pull requests found'

const unavailable = (retryable: boolean): PullRequestReading => ({
  lookup: EPullRequestLookup.Unavailable,
  retryable,
})

const ABSENT: PullRequestReading = { lookup: EPullRequestLookup.Absent }

const outcomeOf = (reading: PullRequestReading): EGhCallOutcome => {
  if (reading.lookup === EPullRequestLookup.Found) return EGhCallOutcome.Found
  if (reading.lookup === EPullRequestLookup.Absent) return EGhCallOutcome.Absent
  return EGhCallOutcome.Unavailable
}

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * A forge that is definitely not GitHub reads as unavailable rather than absent: nobody asked, so
 * "there is no pull request" would be a claim this port cannot make, and `Absent` would also buy a
 * five-minute poll on a repository that can never answer.
 *
 * A pill is decoration: losing one must never take a turn, or opening a thread, down. Nothing
 * throws out of `read` or `readLinked`.
 */
export class GhPullRequestPort extends PullRequestPort {
  readonly pushes = false

  private readonly run: CommandRunner
  private installed = true

  private readonly log: LogPort | null
  private readonly role: EGhPollRole

  constructor(args?: { run?: CommandRunner; log?: LogPort; role?: EGhPollRole }) {
    super()
    this.run = args?.run ?? spawnCommand
    this.log = args?.log ?? null
    this.role = args?.role ?? EGhPollRole.SignedOut
  }

  /**
   * Never `--repo` and never a branch argument: `gh pr view` with no argument resolves the pull
   * request for the checkout's current branch through its remote-tracking config, which is what
   * makes it right in a fork whose head repository is not `origin`. The probed branch keys the
   * cache, not the call.
   */
  async read({ checkout }: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
    if (checkout.forge === EForge.Other) return unavailable(false)

    return this.ask({
      argv: GH_PULL_REQUEST_ARGV,
      cwd: checkout.directory,
      kind: EGhCallKind.Checkout,
      target: basename(checkout.directory),
    })
  }

  /**
   * `gh pr view <number> --repo HOST/OWNER/REPO` needs no checkout at all, which is the point: a
   * linked pull request's worktree may be gone. `Bun.spawn` still wants a directory to start in,
   * so the process's own stands in — gh never consults it once `--repo` is given.
   */
  async readLinked({
    repo,
    number,
  }: {
    repo: string
    number: number
  }): Promise<PullRequestReading> {
    return this.ask({
      argv: linkedArgv({ repo, number }),
      cwd: process.cwd(),
      kind: EGhCallKind.Linked,
      target: `${repo}#${number}`,
    })
  }

  private async ask(request: {
    argv: readonly string[]
    cwd: string
    kind: EGhCallKind
    target: string
  }): Promise<PullRequestReading> {
    if (!this.installed) return unavailable(false)

    const startedAt = performance.now()
    const run = await this.run({
      argv: request.argv,
      cwd: request.cwd,
      timeoutMs: GH_TIMEOUT_MS,
    })
    const reading = this.interpret(run)

    this.log?.info({
      source: GH_CALL_LOG_SOURCE,
      message: 'gh pr view',
      data: {
        role: this.role,
        kind: request.kind,
        target: request.target,
        exitCode: run.code,
        failure: run.failure,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: outcomeOf(reading),
      },
    })

    return reading
  }

  private interpret(run: CommandRun): PullRequestReading {
    if (run.failure !== null) {
      if (run.failure !== ESpawnFailure.BinaryMissing) return unavailable(true)

      this.installed = false
      return unavailable(false)
    }
    if (run.code === GH_AUTH_REQUIRED) return unavailable(false)
    if (run.code !== 0) {
      return run.stderr.includes(NO_PULL_REQUEST_STDERR) ? ABSENT : unavailable(true)
    }

    const pullRequest = parseGhPullRequest(jsonOf(run.stdout))
    if (pullRequest === null) return unavailable(true)

    return { lookup: EPullRequestLookup.Found, pullRequest }
  }
}
