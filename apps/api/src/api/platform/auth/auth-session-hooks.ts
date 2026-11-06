import { db } from '@dltech/atlas-db'

export const deletePushDevicesOfSession = async (session: { id: string }): Promise<void> => {
  await db.orm.public.PushDevice.where({ authSessionId: session.id }).deleteAll()
}
