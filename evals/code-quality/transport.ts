import type { DecisionQuestion } from '@dltech/atlas-core'

import { JevDecisionClient, type JevSystemOne } from '../../packages/harness/src/classifier/jev-client'
import type { DecisionCaller } from './task'

export type LiveConfig = { baseUrl: string; token: string | undefined }

type CallerArgs = { state: string; questions: Record<string, DecisionQuestion>; signal: AbortSignal; model: string }

export function createDecisionCaller({
  mode,
  fakeSystemOne,
  liveConfig,
}: {
  mode: 'fake' | 'live'
  fakeSystemOne?: JevSystemOne | undefined
  liveConfig?: LiveConfig | undefined
}): DecisionCaller {
  if (mode === 'fake') {
    if (fakeSystemOne === undefined) throw new Error('fake mode requires an injected transport')
    const client = new JevDecisionClient({
      config: () => ({ baseUrl: 'http://eval-fake.invalid', token: undefined }),
      systemOne: fakeSystemOne,
    })
    return (args: CallerArgs) => client.decide(args)
  }
  if (liveConfig === undefined) throw new Error('live mode requires an explicit decisions config')
  const config = liveConfig
  const client = new JevDecisionClient({ config: () => config })
  return (args: CallerArgs) => client.decide(args)
}
