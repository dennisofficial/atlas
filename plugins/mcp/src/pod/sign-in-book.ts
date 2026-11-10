import {
  signInResolutionsOf,
  type McpServerRow,
  type McpSignInResolved,
  type OutstandingSignIn,
} from '../core'

/** The sign-ins this session has drawn a card for, until each one settles. */
export class McpSignInBook {
  private pending: readonly OutstandingSignIn[] = []

  note(pending: OutstandingSignIn): void {
    this.pending = [...this.pending.filter((kept) => kept.server !== pending.server), pending]
  }

  resolutionsOf(args: {
    sessionId: string
    rows: readonly McpServerRow[]
    now: number
  }): readonly McpSignInResolved[] {
    const { resolved, outstanding } = signInResolutionsOf({ ...args, pending: this.pending })
    this.pending = outstanding
    return resolved
  }
}
