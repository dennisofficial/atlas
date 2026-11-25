import type { Db } from '@dltech/atlas-db'

import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import {
  OPERATOR_ANSWER_PATH,
  OperatorAnswerService,
  OperatorRequestRegistry,
  OperatorSessionStore,
  operatorAnswerRequestSchema,
} from '..'

export const NOW_MS = Date.parse('2026-11-12T03:00:00.000Z')
export const NOW = new Date(NOW_MS)
export const VALUE = 'marked-value-6f2a'

export const seedSession = async (db: Db, args: { id: string; userId: string }): Promise<void> => {
  await db.orm.public.Session.create({
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
    sandboxProvider: 'vercel',
    credentialSource: 'byok',
    sandboxInstanceId: null,
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

export type RouteAnswer = {
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

const routeAnswer = (status: number, body: unknown): RouteAnswer => ({
  status,
  headers: { get: () => null },
  json: async () => body,
})

export const routeOf = (args: {
  registry: OperatorRequestRegistry
  userId?: string
  trusted?: readonly string[]
}) => {
  const service = new OperatorAnswerService({ registry: args.registry })
  const trusted = args.trusted ?? []
  return async (request: Request): Promise<RouteAnswer> => {
    const origin = request.headers.get('origin')
    if (trusted.length > 0 && (origin === null || !trusted.includes(origin)))
      return routeAnswer(403, { reason: 'origin' })
    const header = request.headers.get('authorization')
    const bearer =
      header?.toLowerCase().startsWith('bearer ') === true ? header.slice(7) : undefined
    const userId = bearer === 'token-1' ? (args.userId ?? 'user-1') : undefined
    if (userId === undefined) return routeAnswer(401, { reason: 'bearer' })
    const parsed = operatorAnswerRequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return routeAnswer(400, { reason: 'body' })
    const answer = await service.answer({ userId, body: parsed.data })
    return routeAnswer(answer.status, answer.body)
  }
}

export const postOf = (args: {
  body: unknown
  bearer?: string
  origin?: string
  method?: string
  path?: string
}): Request =>
  new Request(`https://api.byatlas.io${args.path ?? OPERATOR_ANSWER_PATH}`, {
    method: args.method ?? 'POST',
    headers: {
      ...(args.bearer === undefined ? {} : { authorization: `Bearer ${args.bearer}` }),
      ...(args.origin === undefined ? {} : { origin: args.origin }),
      'content-type': 'application/json',
    },
    ...(args.method === 'OPTIONS' ? {} : { body: JSON.stringify(args.body) }),
  })
