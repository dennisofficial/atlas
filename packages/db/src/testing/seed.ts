import type { Db } from '../client'

export async function seedUser({ db, id }: { db: Db; id: string }) {
  return db.orm.public.User.create({ id, name: id, email: `${id}@test.local` })
}
