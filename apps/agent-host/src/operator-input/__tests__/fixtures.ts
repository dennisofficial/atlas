import type { Db } from '@dltech/atlas-db'
import type { PodOperatorAsk } from '@dltech/atlas-plugin-sdk'

import {
  OPERATOR_ANSWER_PATH,
  OperatorRequestRegistry,
  OperatorRequestStore,
  operatorAnswerOf,
} from '..'

export const NOW_MS = Date.parse('2026-11-12T03:00:00.000Z')
export const NOW = new Date(NOW_MS)
export const VALUE = 'marked-value-6f2a'

export const seedSession = async (db: Db, args: { id: string; userId: string }): Promise<void> => {
  await db.orm.v2.V2Session.create({
    id: args.id,
    userId: args.userId,
    projectId: 'proj-1',
    title: null,
    titledFromInboxId: null,
    mainThreadId: `thr_${args.id}`,
    nextInboxId: 1,
    createdAt: NOW,
    archivedAt: null,
    modelRef: null,
    modelEffort: null,
    modelFast: null,
    spawnedBySessionId: null,
    nested: true,
    podSessionId: null,
    podRetiredAt: null,
    lastSurface: 'web',
    routineId: null,
  })
}

export const askOf = (kind: 'input' | 'shell' = 'input'): PodOperatorAsk =>
  kind === 'shell'
    ? { kind: 'shell', prompt: 'the login code', shellId: 'shl_1' }
    : { kind: 'input', prompt: 'the login code' }

export const clockOf = () => {
  let now = NOW_MS
  const timers = new Map<number, () => void>()
  let next = 1
  return {
    now: () => now,
    timers: {
      setTimeout: (handler: () => void) => {
        const handle = next
        next += 1
        timers.set(handle, handler)
        return handle
      },
      clearTimeout: (handle: unknown) => {
        if (typeof handle === 'number') timers.delete(handle)
      },
    },
    pending: () => timers.size,
    fire: (ms: number) => {
      now += ms
      const due = [...timers.values()]
      timers.clear()
      for (const handler of due) handler()
    },
  }
}

export type Posted = { sessionId: string; kind: string; payload: string }

export const registryOf = (args: {
  db: Db
  clock: ReturnType<typeof clockOf>
  posted?: Posted[] | undefined
  answerTimeoutMs?: number | undefined
}) => {
  const posted = args.posted ?? []
  return new OperatorRequestRegistry({
    store: new OperatorRequestStore(args.db),
    post: async (params) => {
      posted.push({ sessionId: params.sessionId, kind: params.kind, payload: params.payload })
      return { inboxId: 1 }
    },
    withTx: async (run) => await run(undefined as never),
    now: args.clock.now,
    timers: args.clock.timers,
    ...(args.answerTimeoutMs === undefined ? {} : { answerTimeoutMs: args.answerTimeoutMs }),
  })
}

export const routeOf = (args: {
  registry: OperatorRequestRegistry
  userId?: string
  trusted?: readonly string[]
}) =>
  operatorAnswerOf({
    registry: args.registry,
    resolve: async (bearer) =>
      bearer === 'token-1' ? { userId: args.userId ?? 'user-1' } : undefined,
    trustedOrigins: args.trusted ?? [],
  })

export const postOf = (args: {
  body: unknown
  bearer?: string
  origin?: string
  method?: string
  path?: string
}): Request =>
  new Request(`https://agent.byatlas.io${args.path ?? OPERATOR_ANSWER_PATH}`, {
    method: args.method ?? 'POST',
    headers: {
      ...(args.bearer === undefined ? {} : { authorization: `Bearer ${args.bearer}` }),
      ...(args.origin === undefined ? {} : { origin: args.origin }),
      'content-type': 'application/json',
    },
    ...(args.method === 'OPTIONS' ? {} : { body: JSON.stringify(args.body) }),
  })

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) await tick()
}

export const untilTimer = async (clock: { pending(): number }): Promise<void> => {
  for (let i = 0; i < 200 && clock.pending() === 0; i += 1) await tick()
}
