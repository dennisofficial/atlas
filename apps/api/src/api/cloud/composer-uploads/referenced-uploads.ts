import { db, type Tx } from '@dltech/atlas-db'

const SENT_MESSAGE_TYPE = 'user-said'

export async function referencedBySentMessage(args: {
  reader?: Pick<Tx, 'orm'>
  userId: string
  pathname: string
}): Promise<boolean> {
  const reader = args.reader ?? db
  const referencing = await reader.orm.public.Event.where({
    userId: args.userId,
    type: SENT_MESSAGE_TYPE,
  })
    .where((event) => event.body.like(`%${args.pathname}%`))
    .first()
  return referencing !== null
}
