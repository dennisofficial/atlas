import { parseRef, type SaidImage } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

import { titlerModelsOf } from '../config/model-config'
import { scopedSettingsOf } from '../config/scoped-settings'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { providerModelOf } from '../runtime/model-port'
import { OauthConnectionStore } from '../tokens/oauth-connection-store'
import { ModelTokenService } from '../tokens/model-token-service'
import { titleFor } from './title-for'

export type SessionNamer = (args: {
  userId: string
  projectId: string | null
  text: string
  images?: readonly SaidImage[] | undefined
  modelRef?: string | undefined
  signal?: AbortSignal | undefined
  onFault?: ((fault: unknown) => void) | undefined
}) => Promise<string | null>

export function sessionNamerOf(args: {
  db: Db
  cipher: SecretCipher
  tokens?: Pick<ModelTokenService, 'issue'> | undefined
}): SessionNamer {
  const tokens =
    args.tokens ??
    new ModelTokenService({ store: new OauthConnectionStore(args.db), cipher: args.cipher })

  return async (ask) => {
    const { userId, projectId } = ask
    const [accounts, activeAccounts, settings] = await Promise.all([
      args.db.orm.public.AgentAccount.where({ userId }).all(),
      args.db.orm.public.ActiveAccount.where({ userId }).all(),
      scopedSettingsOf({ db: args.db, userId, projectId }),
    ])
    const sessionRef = ask.modelRef === undefined ? undefined : parseRef(ask.modelRef)
    const models = titlerModelsOf({
      cipher: args.cipher,
      accounts,
      activeAccounts,
      settings,
      sessionRef,
    })
    const fallback = models.fallback
    return titleFor({
      model: () => providerModelOf({ userId, tokens, resolved: models.titler }),
      ...(fallback === undefined
        ? {}
        : { fallback: () => providerModelOf({ userId, tokens, resolved: fallback }) }),
      text: ask.text,
      images: ask.images,
      signal: ask.signal,
      onFault: ask.onFault,
    })
  }
}
