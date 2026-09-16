import type { ModelPort } from '@dltech/atlas-core'

import { FaultingModelPort, faultFromEnv } from '../model/faulting-model'

export function faultInjected(inner: ModelPort): ModelPort {
  const spec = faultFromEnv(process.env)
  return spec === null ? inner : new FaultingModelPort({ inner, spec })
}
