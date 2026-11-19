import type {
  PrHead,
  PrRef,
  SessionBranchRow,
  SessionPullRequestRow,
  SessionViewRow,
  TrackedPullRequestRow,
} from '../../port'
import type { State } from './memory-state'
import {
  insertSessionBranchesIn,
  insertSessionPullRequestsIn,
  readSessionViewIn,
  readTrackedPullRequestsIn,
  sessionsTrackingHeadIn,
  sessionsTrackingPullRequestIn,
  writeSessionViewIn,
} from './memory-views'

export class MemoryTxViews {
  protected readonly state: State

  constructor(state: State) {
    this.state = state
  }

  async readSessionView(sessionId: string): Promise<SessionViewRow | undefined> {
    return readSessionViewIn({ state: this.state, sessionId })
  }

  async readSessionViews(sessionIds: readonly string[]): Promise<SessionViewRow[]> {
    return sessionIds.flatMap((sessionId) => {
      const row = readSessionViewIn({ state: this.state, sessionId })
      return row === undefined ? [] : [row]
    })
  }

  async writeSessionView(row: SessionViewRow): Promise<void> {
    writeSessionViewIn({ state: this.state, row })
  }

  async insertSessionBranches(rows: readonly SessionBranchRow[]): Promise<void> {
    insertSessionBranchesIn({ state: this.state, rows })
  }

  async insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void> {
    insertSessionPullRequestsIn({ state: this.state, rows })
  }

  async sessionsTrackingHead(head: PrHead): Promise<string[]> {
    return sessionsTrackingHeadIn({ state: this.state, head })
  }

  async sessionsTrackingPullRequest(pullRequest: PrRef): Promise<string[]> {
    return sessionsTrackingPullRequestIn({ state: this.state, pullRequest })
  }

  async readTrackedPullRequests(sessionIds: readonly string[]): Promise<TrackedPullRequestRow[]> {
    return readTrackedPullRequestsIn({ state: this.state, sessionIds })
  }
}
