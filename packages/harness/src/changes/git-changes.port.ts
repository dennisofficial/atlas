import type { EChangeScope, ReadGitChangesReply } from '@dltech/atlas-wire'

export abstract class GitChangesPort {
  abstract read(args: { scope: EChangeScope }): Promise<ReadGitChangesReply>
}
