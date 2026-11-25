import { withdrawStore, type WithdrawIntent } from '@dltech/atlas-client/session'

const WITHDRAW_INTENTS_KEY = 'atlas.withdraw-intents'

const storageOf = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

const readIntents = (): readonly unknown[] => {
  const raw = storageOf()?.getItem(WITHDRAW_INTENTS_KEY)
  if (raw === null || raw === undefined) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

withdrawStore.attachPersistence({
  load: readIntents,
  save: (intents: readonly WithdrawIntent[]) => {
    try {
      storageOf()?.setItem(WITHDRAW_INTENTS_KEY, JSON.stringify(intents))
    } catch {
      return
    }
  },
})
