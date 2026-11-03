import { EFFORT_LADDER, parseRef } from '@dltech/atlas-core'
import type { SelectableModel } from '@dltech/atlas-harness'

import type { ServeModelBridge } from './serve-app'

export function serveModelBridgeOf(model: SelectableModel): ServeModelBridge {
  return {
    effort: () => model.choice().effort,
    fast: () => model.choice().fast === true,
    identity: () => model.choice().ref,
    select: (next) => {
      const ref = parseRef(next.ref)
      if (ref === undefined) return
      const effort = EFFORT_LADDER.find((rung) => rung === next.effort) ?? model.choice().effort
      model.select({
        ref,
        effort,
        ...(next.fast === undefined ? {} : { fast: next.fast }),
      })
    },
  }
}
