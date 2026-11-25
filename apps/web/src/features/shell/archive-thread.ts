import { archiveSession } from '@/features/sessions/data/sessions-api'

export function archiveThread(args: { threadId: string; archived: boolean }): Promise<unknown> {
  return archiveSession({ sessionId: args.threadId, archived: args.archived })
}
