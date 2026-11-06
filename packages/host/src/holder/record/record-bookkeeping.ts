import type {
  BranchObservation,
  ScheduledRetry,
  V2Event,
  WorkspaceRecord,
} from '@dltech/atlas-core'

export type DispatchedCall = { bootId?: string | undefined }

export type RecordedFact = { key: string; value: unknown }

export type FactLookup = { found: true; value: unknown } | { found: false }

export class RecordBookkeeping {
  private readonly dispatched = new Map<string, DispatchedCall>()
  private readonly firstFacts = new Map<string, unknown>()
  private readonly facts: RecordedFact[] = []
  private readonly firstRetries = new Map<string, ScheduledRetry>()
  private readonly retries: ScheduledRetry[] = []
  private readonly observations = new Map<string, BranchObservation>()
  private workspaceRecord: WorkspaceRecord = { prepared: false, failure: undefined }
  private userSaidSeq = 0

  step(event: V2Event): void {
    switch (event.type) {
      case 'tool-dispatched':
        this.dispatched.set(event.callId, { bootId: event.bootId })
        return
      case 'fact-recorded':
        this.recordFact({ key: event.key, value: event.value })
        return
      case 'retry-scheduled':
        this.recordRetry({
          key: event.key,
          notBefore: event.notBefore,
          attempt: event.attempt,
          reason: event.reason,
        })
        return
      case 'branches-observed':
        this.observations.set(event.repo, {
          repo: event.repo,
          head: event.head,
          branches: event.branches,
          worktrees: event.worktrees,
        })
        return
      case 'workspace-prepared':
        this.workspaceRecord = { ...this.workspaceRecord, prepared: true }
        return
      case 'workspace-prepare-failed':
        this.workspaceRecord = {
          ...this.workspaceRecord,
          failure: { inboxHead: event.inboxHead, reason: event.reason, at: event.at },
        }
        return
      case 'user-said':
        this.userSaidSeq = event.seq
        this.workspaceRecord = { ...this.workspaceRecord, prepared: true }
        return
      default:
        return
    }
  }

  private recordFact(fact: RecordedFact): void {
    this.facts.push(fact)
    if (!this.firstFacts.has(fact.key)) this.firstFacts.set(fact.key, fact.value)
  }

  private recordRetry(retry: ScheduledRetry): void {
    this.retries.push(retry)
    if (!this.firstRetries.has(retry.key)) this.firstRetries.set(retry.key, retry)
  }

  findDispatched(callId: string): DispatchedCall | undefined {
    return this.dispatched.get(callId)
  }

  fact(key: string): FactLookup {
    if (!this.firstFacts.has(key)) return { found: false }
    return { found: true, value: this.firstFacts.get(key) }
  }

  factsWithPrefix(prefix: string): RecordedFact[] {
    return this.facts.filter((fact) => fact.key.startsWith(prefix))
  }

  retry(key: string): ScheduledRetry | undefined {
    return this.firstRetries.get(key)
  }

  retriesWithPrefix(prefix: string): ScheduledRetry[] {
    return this.retries.filter((retry) => retry.key.startsWith(prefix))
  }

  lastObservation(repo: string): BranchObservation | undefined {
    return this.observations.get(repo)
  }

  workspace(): WorkspaceRecord {
    return this.workspaceRecord
  }

  lastUserSaidSeq(): number {
    return this.userSaidSeq
  }
}
