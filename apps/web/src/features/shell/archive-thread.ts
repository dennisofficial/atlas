import { archiveV2Session } from '@/features/sessions/data/sessions-api'

export function archiveThread(args: { threadId: string; archived: boolean }): Promise<unknown> {
  return archiveV2Session({ sessionId: args.threadId, archived: args.archived })
}
