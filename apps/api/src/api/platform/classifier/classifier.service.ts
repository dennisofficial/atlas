import { classifierOf } from '@dltech/atlas-classifier'
import { EClassifierFault, type ClassifierQuestion } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { Inject, Injectable } from '@nestjs/common'

import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { classifierConfigOf } from '../../../agent/config/classifier-config'
import { scopedSettingsOf } from '../../../agent/config/scoped-settings'

export const CLASSIFIER_FETCH = Symbol('CLASSIFIER_FETCH')

const DEADLINE_MS = 2000

const CHECK_QUESTIONS: Record<string, ClassifierQuestion> = {
  connected: { type: 'noul', instructions: 'Is this a connection check?' },
}

export type ClassifierTestResult =
  | { ok: true; model: string; ms: number }
  | { ok: false; fault: EClassifierFault; detail: string }

@Injectable()
export class ClassifierService {
  constructor(
    @Inject(SecretCipherService) private readonly cipher: SecretCipherService,
    @Inject(CLASSIFIER_FETCH) private readonly http: typeof globalThis.fetch,
  ) {}

  async test(args: { userId: string }): Promise<ClassifierTestResult> {
    const [accounts, activeAccounts, settings] = await Promise.all([
      db.orm.public.AgentAccount.where({ userId: args.userId }).all(),
      db.orm.public.ActiveAccount.where({ userId: args.userId }).all(),
      scopedSettingsOf({ db, userId: args.userId, projectId: null }),
    ])
    const classifier = classifierOf(
      classifierConfigOf({ cipher: this.cipher, accounts, activeAccounts, settings }),
      { fetch: this.http },
    )
    const startedAt = Date.now()
    const outcome = await classifier.classify({
      state: 'Atlas is checking that the classifier answers.',
      questions: CHECK_QUESTIONS,
      signal: AbortSignal.timeout(DEADLINE_MS),
    })
    if (!outcome.ok) return outcome
    return { ok: true, model: outcome.model, ms: Date.now() - startedAt }
  }
}
