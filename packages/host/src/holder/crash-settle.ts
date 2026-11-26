import { ECrashedCall } from '@dltech/atlas-agent'
import { EToolEffect } from '@dltech/atlas-core'

import type { SessionRuntime } from './ports'

export const crashSettleOf = (args: { runtime: SessionRuntime; name: string }): ECrashedCall => {
  if (args.runtime.daemonTools.has(args.name)) return ECrashedCall.Hold
  return args.runtime.effectOf(args.name) === EToolEffect.Read
    ? ECrashedCall.Hold
    : ECrashedCall.Interrupt
}
