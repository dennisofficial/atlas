import { type ThreadId } from '@dltech/atlas-core'
import type { CloudStores } from '@dltech/atlas-harness'
import type { ToolEffects } from '../../store/log-accumulator'
import type { OpenedConversation } from '../open-conversation'
import { readThreadSpend } from '../thread-spend'
import { readThreadBase, readThreadWindow } from '../thread-reads'
import { EThreadRows } from '../use-thread-view'

/**
 * Attaching to a lifted session is not opening a local conversation: the transcript belongs to
 * the sandbox's loop, and the stores that read it refuse every mutation. So the attach binds the
 * UI straight from the remote reads and never touches the local-ownership machinery — no
 * adoption, no session lock, no lost-agent or lost-shell settlement.
 */
export async function attachCloudSession(args: {
  stores: CloudStores
  threadId: ThreadId
  effects: ToolEffects
}): Promise<OpenedConversation> {
  const { stores, threadId } = args
  const thread = await stores.threads.find({ threadId })
  if (thread === undefined) throw new Error(`the lifted session holds no thread "${threadId}"`)

  const window = await readThreadWindow({
    log: stores.log,
    threadId: thread.id,
    rows: EThreadRows.Composed,
  })
  const [base, spent] = await Promise.all([
    readThreadBase({
      log: stores.log,
      threadId: thread.id,
      rows: EThreadRows.Composed,
      fromSeq: window.fromSeq,
      effects: args.effects,
    }),
    readThreadSpend({ ledger: stores.ledger, threadId: thread.id }),
  ])

  return {
    threadId: thread.id,
    events: window.events,
    turns: spent.turns,
    name: thread.title ?? null,
    started: true,
    model: thread.model,
    executionLocation: thread.executionLocation,
    lostShells: [],
    base,
  }
}
