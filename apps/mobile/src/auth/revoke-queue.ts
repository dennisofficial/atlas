import { z } from 'zod'

export interface IPendingRevokeStorage {
  load: () => Promise<string | undefined>
  save: (value: string) => Promise<void>
  clear: () => Promise<void>
}

export type TRevoke = (token: string) => Promise<boolean>

const tokensSchema = z.array(z.string())

const loadTokens = async (storage: IPendingRevokeStorage): Promise<string[]> => {
  const raw = await storage.load()
  if (raw === undefined) return []
  try {
    const parsed = tokensSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

const saveTokens = async ({
  storage,
  tokens,
}: {
  storage: IPendingRevokeStorage
  tokens: string[]
}): Promise<void> => {
  if (tokens.length === 0) {
    await storage.clear()
    return
  }
  await storage.save(JSON.stringify(tokens))
}

export const revokeOrPersist = async ({
  storage,
  revoke,
  token,
}: {
  storage: IPendingRevokeStorage
  revoke: TRevoke
  token: string
}): Promise<void> => {
  if (await revoke(token).catch(() => false)) return
  const tokens = await loadTokens(storage)
  if (tokens.includes(token)) return
  await saveTokens({ storage, tokens: [...tokens, token] })
}

export const retryPendingRevokes = async ({
  storage,
  revoke,
}: {
  storage: IPendingRevokeStorage
  revoke: TRevoke
}): Promise<void> => {
  const tokens = await loadTokens(storage)
  if (tokens.length === 0) return
  const remaining: string[] = []
  for (const token of tokens) {
    if (!(await revoke(token).catch(() => false))) remaining.push(token)
  }
  await saveTokens({ storage, tokens: remaining })
}
