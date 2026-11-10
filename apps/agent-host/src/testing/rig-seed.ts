import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import {
  ControlPlane,
  ControlStorePort,
  type ControlTx,
  type ListDueRoutinesParams,
  type RoutineRow,
} from '@dltech/atlas-control'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

const SEED_HOST_ID = 2_000_000_000

class JoinedStore extends ControlStorePort {
  constructor(
    private readonly owner: ControlStorePort,
    private readonly tx: ControlTx,
  ) {
    super()
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return work(this.tx)
  }

  listDueRoutines(params: ListDueRoutinesParams): Promise<RoutineRow[]> {
    return this.owner.listDueRoutines(params)
  }
}

const seedPrepared = async (args: {
  plane: ControlPlane
  sessionId: string
  threadId: string
}): Promise<void> => {
  const { plane } = args
  const { epoch } = await plane.grant({ sessionId: args.sessionId, hostId: SEED_HOST_ID })
  const head = await plane.head({ threadId: args.threadId })
  const outcome = await plane.append({
    threadId: args.threadId,
    epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('seed-prepared'),
      epoch,
      at: new Date().toISOString(),
      bodies: [{ type: 'workspace-prepared' }],
      from: head,
    }),
  })
  if (!outcome.ok) throw new Error(`seeding prepared refused: ${JSON.stringify(outcome.refusal)}`)
  await plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
}

export const seedSession = async (args: {
  store: ControlStorePort
  sessionId: string
  text: string
  prepared: boolean
}): Promise<string> => {
  const mainThreadId = `thread-${args.sessionId}`
  await args.store.transact(async (tx) => {
    const plane = new ControlPlane({ store: new JoinedStore(args.store, tx) })
    await plane.createSession({
      sessionId: args.sessionId,
      userId: 'user-1',
      projectId: 'proj-1',
      mainThreadId,
    })
    if (args.prepared) {
      await seedPrepared({ plane, sessionId: args.sessionId, threadId: mainThreadId })
    }
    await plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: args.text }),
    })
  })
  return mainThreadId
}
