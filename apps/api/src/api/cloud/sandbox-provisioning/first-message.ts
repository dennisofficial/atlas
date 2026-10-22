import { db, type Tx } from '@dltech/atlas-db'
import type { EventDraftDto } from '../../platform/sessions/sessions.dto'

export type FirstMessage = { sendId: string; text: string }

export const userSaidDraftOf = (message: FirstMessage): EventDraftDto => ({
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text: message.text, requestId: message.sendId }),
})

const requestIdOf = (body: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const requestId = (parsed as { requestId?: unknown }).requestId
    return typeof requestId === 'string' ? requestId : undefined
  } catch {
    return undefined
  }
}

export async function findUserSaid(args: {
  reader?: Pick<Tx, 'orm'>
  threadId: string
  sendId: string
}) {
  const reader = args.reader ?? db
  const needle = `%"requestId":${JSON.stringify(args.sendId)}%`
  const candidates = await reader.orm.public.Event.where({
    threadId: args.threadId,
    type: 'user-said',
  })
    .where((event) => event.body.like(needle))
    .orderBy((event) => event.seq.desc())
    .all()
  return candidates.find((event) => requestIdOf(event.body) === args.sendId) ?? null
}
