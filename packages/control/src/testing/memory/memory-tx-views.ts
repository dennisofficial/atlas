import type { PrHead, SessionBranchRow, SessionViewRow, TrackedPullRequestRow } from '../../port'
import type { State } from './memory-state'
import {
  insertSessionBranchesIn,
  readSessionViewIn,
  readTrackedPullRequestsIn,
  sessionsTrackingHeadIn,
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

  async writeSessionView(row: SessionViewRow): Promise<void> {
    writeSessionViewIn({ state: this.state, row })
  }

  async insertSessionBranches(rows: readonly SessionBranchRow[]): Promise<void> {
    insertSessionBranchesIn({ state: this.state, rows })
  }

  async sessionsTrackingHead(head: PrHead): Promise<string[]> {
    return sessionsTrackingHeadIn({ state: this.state, head })
  }

  async readTrackedPullRequests(sessionIds: readonly string[]): Promise<TrackedPullRequestRow[]> {
    return readTrackedPullRequestsIn({ state: this.state, sessionIds })
  }
}
