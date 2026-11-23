import {
  authProviderOf,
  chosenFor,
  parsedAccountsOf,
  type SealedAccountRowLike,
} from '@dltech/atlas-credentials'
import { parseRef, type EAuthProvider } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

export type UsageAccountRow = SealedAccountRowLike & { userId: string }

export type UsageSessionOwner = { userId: string; provider: EAuthProvider | undefined }

export type UsageAccounts = {
  owned(args: { userId: string; accountId: string }): Promise<UsageAccountRow | null>
  chosen(args: { userId: string; provider: EAuthProvider }): Promise<UsageAccountRow | null>
  sessionOwner(args: { sessionId: string }): Promise<UsageSessionOwner | null>
}

const providerOfRef = (modelRef: string): EAuthProvider | undefined => {
  const ref = parseRef(modelRef)
  return ref === undefined ? undefined : authProviderOf(ref.providerId)
}

export const prismaUsageAccounts = ({ db }: { db: Db }): UsageAccounts => ({
  async owned({ userId, accountId }) {
    return db.orm.public.AgentAccount.first({ id: accountId, userId })
  },
  async chosen({ userId, provider }) {
    const [rows, activeAccounts] = await Promise.all([
      db.orm.public.AgentAccount.where({ userId }).all(),
      db.orm.public.ActiveAccount.where({ userId }).all(),
    ])
    const chosen = chosenFor({ provider, parsed: parsedAccountsOf(rows), activeAccounts })
    return chosen?.row ?? null
  },
  async sessionOwner({ sessionId }) {
    const session = await db.orm.v2.V2Session.first({ id: sessionId })
    if (session === null) return null
    return { userId: session.userId, provider: providerOfRef(session.modelRef) }
  },
})
