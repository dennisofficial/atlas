import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  transcriptIdentityDigest,
  transcriptIdentityReplySchema,
  type CloudAttachment,
  type TurnLedgerPort,
} from '@dltech/atlas-harness'
import { walkRegularFiles } from '../../../../packages/harness/src/cloud/session-walker'
import { checkedGit } from './environment'
import { assertIdleSuffix, turnDigest } from './idle'

export type CapturedIdentity = { count: number; digest: string; upTo: number; turns: string }

export const sessionFileDigest = async (directory: string): Promise<string> => {
  const hash = createHash('sha256')
  const files = await walkRegularFiles({ root: directory })
  if (files === undefined) throw new Error('source session disappeared')
  for (const key of files) {
    hash.update(`${key}\0`)
    hash.update(await readFile(join(directory, key)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export const captureIdentities = async (args: {
  log: EventLogPort
  ledger: TurnLedgerPort
  threadIds: readonly ThreadId[]
}): Promise<Map<ThreadId, CapturedIdentity>> => {
  const identities = new Map<ThreadId, CapturedIdentity>()
  for (const threadId of args.threadIds) {
    const events = await args.log.readOwn({ threadId })
    identities.set(threadId, {
      count: events.length,
      digest: transcriptIdentityDigest(events),
      upTo: events.reduce((head, event) => Math.max(head, event.seq), 0),
      turns: turnDigest(await args.ledger.forThread({ threadId })),
    })
  }
  return identities
}

export const verifyRemoteIdentities = async (args: {
  attachment: CloudAttachment
  expected: ReadonlyMap<ThreadId, CapturedIdentity>
}): Promise<void> => {
  for (const [threadId, expected] of args.expected) {
    const actual = transcriptIdentityReplySchema.parse(
      await args.attachment.channel.request({
        op: EClientRequest.ReadTranscriptIdentity,
        params: { threadId, upTo: expected.upTo },
      }),
    )
    if (actual.count !== expected.count || actual.digest !== expected.digest)
      throw new Error(`cloud fixture identity mismatch for ${threadId}`)
    assertIdleSuffix({
      threadId,
      upTo: expected.upTo,
      events: await args.attachment.stores.log.readOwn({ threadId, fromSeq: expected.upTo }),
    })
    if (turnDigest(await args.attachment.stores.ledger.forThread({ threadId })) !== expected.turns)
      throw new Error(`new benchmark turn recorded in ${threadId}`)
  }
}

export const verifyLocalIdentities = async (args: {
  log: EventLogPort
  ledger: TurnLedgerPort
  expected: ReadonlyMap<ThreadId, CapturedIdentity>
}): Promise<void> => {
  for (const [threadId, expected] of args.expected) {
    const events = await args.log.readOwn({ threadId, upTo: expected.upTo })
    if (events.length !== expected.count || transcriptIdentityDigest(events) !== expected.digest)
      throw new Error(`descended fixture identity mismatch for ${threadId}`)
    assertIdleSuffix({
      threadId,
      upTo: expected.upTo,
      events: await args.log.readOwn({ threadId, fromSeq: expected.upTo }),
    })
    if (turnDigest(await args.ledger.forThread({ threadId })) !== expected.turns)
      throw new Error(`new benchmark turn recorded in ${threadId}`)
  }
}

export const workspaceSentinels = async (cwd: string): Promise<string> => {
  const values = await Promise.all([
    readFile(join(cwd, 'README.md'), 'utf8'),
    checkedGit({ cwd, argv: ['show', ':README.md'] }),
    readFile(join(cwd, 'cloud-bench-untracked.txt'), 'utf8'),
  ])
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}
