import type { Db } from '@dltech/atlas-db'

import { SecretCipher } from '../../config/secret-cipher'
import {
  OPERATOR_ANSWER_PATH,
  OperatorRequestRegistry,
  OperatorSessionStore,
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
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'medium',
    modelFast: false,
    spawnedBySessionId: null,
    nested: true,
    podSessionId: null,
    podRetiredAt: null,
    lastSurface: 'web',
    routineId: null,
  })
}

export const SESSION = 'ses_1'
export const CALL = 'call_1'
export const cipher = new SecretCipher('f'.repeat(64))

export type Posted = { sessionId: string; kind: string; payload: string }

export const registryOf = (args: { db: Db; posted?: Posted[] | undefined }) => {
  const posted = args.posted ?? []
  return new OperatorRequestRegistry({
    store: new OperatorSessionStore(args.db),
    post: async (params) => {
      posted.push({ sessionId: params.sessionId, kind: params.kind, payload: params.payload })
      return { inboxId: 1 }
    },
    withTx: async (run) => await run(undefined as never),
    seal: (value) => cipher.encrypt(value),
    now: () => NOW_MS,
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
