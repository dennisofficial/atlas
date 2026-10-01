import type { Event, ThreadId } from '@dltech/atlas-core'
import { EClientRequest, transcriptIdentityReplySchema } from '../channel-wire'
import { transcriptIdentityDigest } from '../event-identity'
import type { CloudAttachment } from './cloud-bridge'

export async function verifyTranscript(args: {
  attachment: CloudAttachment
  expected: ReadonlyMap<ThreadId, readonly Event[]>
}): Promise<void> {
  for (const [threadId, expected] of args.expected) {
    const upTo = expected.reduce((head, event) => Math.max(head, event.seq), 0)
    const actual = transcriptIdentityReplySchema.parse(
      await args.attachment.channel.request({
        op: EClientRequest.ReadTranscriptIdentity,
        params: { threadId, upTo },
      }),
    )
    if (actual.count === expected.length && actual.digest === transcriptIdentityDigest(expected))
      continue
    throw new Error(
      `the cloud transcript does not match the captured events of ${threadId} — refusing the ownership flip`,
    )
  }
}
