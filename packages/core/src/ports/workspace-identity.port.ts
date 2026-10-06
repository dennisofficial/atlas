import type { ThreadId } from '../events/ids'

export abstract class WorkspaceIdentityPort {
  abstract identify(args: {
    projectDirectory: string
    threadId: ThreadId
  }): Promise<{ remote: string | null; worktreePath: string | null }>
}
