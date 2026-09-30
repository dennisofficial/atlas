import type { AgentRegistryPort } from '../agents/registry/port'
import type { PendingQueues } from '../pending'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'
import { retainedSource } from './retained-source'
import type { IntakeSource } from './message-intake'

export function noticeSources(args: {
  shells: ShellRegistryPort
  agents: AgentRegistryPort
  services: ServiceRegistryPort
}): readonly IntakeSource[] {
  return [args.shells, args.agents, args.services].map((registry): IntakeSource => {
    const source: Omit<IntakeSource, 'prepare'> = {
      subscribe: (listener) => registry.onNotice(listener),
      threadsAwaitingInput: () => registry.threadsAwaitingNotice(),
      threadsWithPendingInput: () => registry.threadsWithPendingInput?.() ?? registry.threadsAwaitingNotice(),
      witness: ({ threadId }) => registry.pendingNotices({ threadId }),
    }
    const prepare = registry.prepareNotifications?.bind(registry)
    if (prepare !== undefined) return { ...source, prepare }
    return retainedSource({
      ...source,
      witness: (request) => registry.pendingNotices(request),
      drain: (request) => {
        const drained = registry.drainNotifications(request)
        return 'drafts' in drained ? drained.drafts : drained
      },
    })
  })
}

export function operatorSource<Command>(pending: PendingQueues<Command>): IntakeSource {
  return {
    submit: ({ threadId, ...said }) => pending.forThread({ threadId }).enqueue(said),
    prepare: ({ threadId }) => pending.forThread({ threadId }).prepare(),
    subscribe: (listener) => pending.subscribe(listener),
    threadsAwaitingInput: () => pending.threadsAwaitingInput(),
    witness: ({ threadId }) => pending.forThread({ threadId }).getSnapshot(),
  }
}
