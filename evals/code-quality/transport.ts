import type { DecisionQuestion } from '@dltech/atlas-core'

import { JevDecisionClient, type JevSystemOne } from '../../packages/harness/src/classifier/jev-client'
import { ERunMode } from '../src/results'
import type { DecisionCaller } from './task'

export type LiveConfig = { baseUrl: string; token: string | undefined }

export const LIVE_TOKEN_ENV = 'ATLAS_EVAL_DECISIONS_TOKEN'

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
  if (liveConfig === undefined) throw new Error('live mode requires an explicit decisions config')
  const config: LiveConfig = { baseUrl: liveConfig.baseUrl, token: process.env[LIVE_TOKEN_ENV] }
  const client = new JevDecisionClient({ config: () => config })
  return (args: CallerArgs) => client.decide(args)
}
