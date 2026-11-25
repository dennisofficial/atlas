import { db, type Tx } from '@dltech/atlas-db'

export async function referencedByDraft(args: {
  reader?: Pick<Tx, 'orm'>
  userId: string
  pathname: string
}): Promise<boolean> {
  const reader = args.reader ?? db
  const referencing = await reader.orm.public.SessionDraft.where({ userId: args.userId })
    .where((draft) => draft.attachments.like(`%${args.pathname}%`))
    .first()
  return referencing !== null
}
