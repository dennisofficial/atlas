import { EResume, resumePlan, type Event, type EventLogPort, type ThreadId } from '@dltech/atlas-core'
import {
  rewindThread,
  type AgentRegistryPort,
  type RewindKill,
  type ServiceRegistryPort,
  type ShellRegistryPort,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

export enum EDiscard {
  Discarded = 'discarded',
  Refused = 'refused',
  Nothing = 'nothing',
  NeedsConfirmation = 'needs-confirmation',
}

export type Discard =
  | { type: EDiscard.Discarded }
  | { type: EDiscard.Refused; reason: string }
  | { type: EDiscard.Nothing }
  | { type: EDiscard.NeedsConfirmation; toSeq: number; kills: readonly RewindKill[] }

export async function discardInterrupted(args: {
  log: EventLogPort
  threads: ThreadStorePort
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  threadId: ThreadId
  confirmed?: boolean
}): Promise<Discard> {
  const { log, threads, agents, shells, services, threadId } = args

  const events: readonly Event[] = await log.readOwn({ threadId })
  const plan = resumePlan(events)
  if (plan.kind !== EResume.Nudge) return { type: EDiscard.Nothing }

  const rewound = await rewindThread({
    log,
    threads,
    agents,
    shells,
    services,
    threadId,
    toSeq: plan.interrupted.seq - 1,
    ...(args.confirmed === undefined ? {} : { confirmed: args.confirmed }),
  })
  if (!rewound.ok) {
    if ('needsConfirmation' in rewound) {
      return { type: EDiscard.NeedsConfirmation, toSeq: rewound.toSeq, kills: rewound.kills }
    }
    return { type: EDiscard.Refused, reason: rewound.reason }
  }

  return { type: EDiscard.Discarded }
}
