import { withdrawStore, type WithdrawIntent } from '@dltech/atlas-client/session'

import { kvJsonStore } from '../../storage/kv-json-store'

const WITHDRAW_INTENTS_KEY = 'withdraw-intents'

const store = kvJsonStore({ database: 'atlas-withdraw' })

withdrawStore.attachPersistence({
  load: async () => {
    const held = await store.read(WITHDRAW_INTENTS_KEY).catch(() => undefined)
    return Array.isArray(held) ? held : []
  },
  save: (intents: readonly WithdrawIntent[]) => {
    void store.write(WITHDRAW_INTENTS_KEY, intents).catch(() => undefined)
  },
})
