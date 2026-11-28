import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'

export const recordGoogleSession = async (args: {
  sessionId: string
  userId: string
  path: string | undefined
  provider: unknown
}): Promise<void> => {
  if (args.path !== '/callback/:id' && args.path !== '/callback/google') return
  if (args.provider !== 'google') return
  await db.orm.public.Verification.create({
    id: randomUUID(),
    identifier: `google-session:${args.sessionId}`,
    value: args.userId,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}
