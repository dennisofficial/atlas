import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { transcriptIdentityDigest, type CloudStores } from '@dltech/atlas-harness'
import type { ToolEffects } from '../../store/log-accumulator'
import type { OpenedConversation } from '../open-conversation'
import { readThreadSpend } from '../thread-spend'
import { readThreadSnapshot } from '../thread-reads'
import { EThreadRows } from '../use-thread-view'

export class MissingCloudThreadError extends Error {
  constructor(threadId: ThreadId) {
    super(`the lifted session holds no thread "${threadId}"`)
    this.name = 'MissingCloudThreadError'
  }
}

/**
 * Attaching to a lifted session is not opening a local conversation: the transcript belongs to
 * the sandbox's loop, and the stores that read it refuse every mutation. So the attach binds the
 * UI straight from the remote reads and never touches the local-ownership machinery — no
 * adoption, no session lock, no lost-agent or lost-shell settlement. The window, the base and the
 * transcript identity all come from one full snapshot read: an append or rewind landing between
 * separate reads would have them describe different transcripts, and the identity is the only
 * proof the applied view is complete.
 */
export async function attachCloudSession(args: {
  stores: CloudStores
  threadId: ThreadId
  effects: ToolEffects
}): Promise<OpenedConversation> {
  const { stores, threadId } = args
  const thread = await stores.threads.find({ threadId })
  if (thread === undefined) throw new MissingCloudThreadError(threadId)

  const snapshot = await readThreadSnapshot({
    log: stores.log,
    threadId: thread.id,
    rows: EThreadRows.Composed,
    effects: args.effects,
    digest: transcriptIdentityDigest,
  })
  const spent = await readThreadSpend({ ledger: stores.ledger, threadId: thread.id })

  return {
    threadId: thread.id,
    events: snapshot.events,
    turns: spent.turns,
    name: thread.title ?? null,
    started: true,
    model: thread.model,
    // The truth of an attached thread is cloud — not whatever the remote meta happens to say.
    executionLocation: EExecutionLocation.Cloud,
    lostShells: [],
    base: snapshot.base,
    identity: snapshot.identity,
    appliedEvents: snapshot.all,
  }
}
