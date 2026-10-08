import { readFileSync } from 'node:fs'

import { DECISIONS_PRESETS, EDecisionsProvider, type DecisionQuestion } from '@dltech/atlas-core'

import { JevDecisionClient, type JevSystemOne } from '../../packages/harness/src/classifier/jev-client'
import { OpenAiDecisionClient } from '../../packages/harness/src/classifier/openai-decision-client'
import { ERunMode } from '../src/results'
import type { DecisionCaller } from './task'

export type LiveConfig = { baseUrl: string; token: string | undefined }

export const LIVE_TOKEN_ENV = 'ATLAS_EVAL_DECISIONS_TOKEN'
export const OPENAI_BACKEND_ENV = 'ATLAS_EVAL_BACKEND'
export const OPENAI_KEY_FILE_ENV = 'ATLAS_EVAL_OPENAI_KEY_FILE'
const OPENAI_EVAL_TIMEOUT_MS = 30_000

type CallerArgs = { state: string; questions: Record<string, DecisionQuestion>; signal: AbortSignal; model: string }

export function createDecisionCaller({
  mode,
  fakeSystemOne,
  liveConfig,
}: {
  mode: ERunMode
  fakeSystemOne?: JevSystemOne | undefined
  liveConfig?: LiveConfig | undefined
}): DecisionCaller {
  if (mode === ERunMode.Fake) {
    if (fakeSystemOne === undefined) throw new Error('fake mode requires an injected transport')
    const client = new JevDecisionClient({
      config: () => ({ baseUrl: 'http://eval-fake.invalid', token: undefined }),
      systemOne: fakeSystemOne,
    })
    return (args: CallerArgs) => client.decide(args)
  }
  if (process.env[OPENAI_BACKEND_ENV] === 'openai') {
    const keyFile = process.env[OPENAI_KEY_FILE_ENV]
    if (keyFile === undefined || keyFile.length === 0) {
      throw new Error(`live openai backend requires ${OPENAI_KEY_FILE_ENV} naming a readable key file`)
    }
    const token = readFileSync(keyFile, 'utf8').trim()
    return (args: CallerArgs) =>
      new OpenAiDecisionClient({
        config: () => ({ url: DECISIONS_PRESETS[EDecisionsProvider.OpenAi].url, token, model: args.model }),
        timeoutMs: OPENAI_EVAL_TIMEOUT_MS,
      }).decide(args)
  }
  if (liveConfig === undefined) throw new Error('live mode requires an explicit decisions config')
  const config: LiveConfig = { baseUrl: liveConfig.baseUrl, token: process.env[LIVE_TOKEN_ENV] }
  const client = new JevDecisionClient({ config: () => config })
  return (args: CallerArgs) => client.decide(args)
}
