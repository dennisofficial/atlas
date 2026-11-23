export const WORKSPACE_IDENTITY_TIMEOUT_MS = 750

export class WorkspaceIdentityDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`workspace identity probe exceeded ${timeoutMs}ms`)
    this.name = 'WorkspaceIdentityDeadlineError'
  }
}
