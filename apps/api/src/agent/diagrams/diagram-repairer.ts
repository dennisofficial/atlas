import { EEffort, refKey, type DiagramRepairOutcome } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import { sessionModelSourceOf } from '../config/config-reader'
import { providerModelOf } from '../runtime/model-port'
import { ModelTokenService } from '../tokens/model-token-service'
import { OauthConnectionStore } from '../tokens/oauth-connection-store'
import { repairDiagramText } from './repair-text'

export type DiagramRepairer = (args: {
  sessionId: string
  source: string
  error: string
  context?: string | undefined
  signal?: AbortSignal | undefined
}) => Promise<{ outcome: DiagramRepairOutcome; modelRef: string }>

export function diagramRepairerOf(args: {
  db: Db
  cipher: SecretCipher
  tokens?: Pick<ModelTokenService, 'issue'> | undefined
}): DiagramRepairer {
  const tokens =
    args.tokens ??
    new ModelTokenService({ store: new OauthConnectionStore(args.db), cipher: args.cipher })

  return async (ask) => {
    const { userId, models } = await sessionModelSourceOf({
      db: args.db,
      cipher: args.cipher,
      sessionId: ask.sessionId,
    })
    const resolved = models.pinned({
      ref: models.main.choice.ref,
      effort: EEffort.Low,
      fast: false,
    })
    const modelRef = refKey(
      resolved.config.configured === true ? resolved.config.ref : resolved.choice.ref,
    )
    const outcome = await repairDiagramText({
      model: () => providerModelOf({ userId, tokens, resolved }),
      source: ask.source,
      error: ask.error,
      context: ask.context,
      signal: ask.signal,
    })
    return { outcome, modelRef }
  }
}
