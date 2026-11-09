import type {
  PrStateRow,
  SessionPullRequestKey,
  SessionPullRequestRow,
  SessionViewRow,
} from '../../port'
import type { State } from './memory-state'
import {
  insertSessionPullRequestsIn,
  readPrStatesIn,
  readSessionViewIn,
  sessionsLinkedToIn,
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

  async insertSessionPullRequests(rows: readonly SessionPullRequestRow[]): Promise<void> {
    insertSessionPullRequestsIn({ state: this.state, rows })
  }

  async sessionsLinkedTo(key: SessionPullRequestKey): Promise<string[]> {
    return sessionsLinkedToIn({ state: this.state, key })
  }

  async readPrStates(keys: readonly SessionPullRequestKey[]): Promise<PrStateRow[]> {
    return readPrStatesIn({ state: this.state, keys })
  }
}
