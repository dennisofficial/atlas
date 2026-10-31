import { EventLogPort } from '@dltech/atlas-core'

import { SessionActivityPort } from '../activity/port'
import { RuntimeSessionActivity } from '../activity/runtime-session-activity'
import { AgentRegistryPort } from '../agents/registry/port'
import type { DeltaChannel } from '../channel/delta-channel'
import { registerDisposable } from '../container/disposal'
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import type { TurnPolicy } from '../loop/turn-policy'
import { OperatorInputPort } from '../operator-input/port'
import { ShellRegistryPort } from '../shells/shell-registry'

export const withActivityFailures = (args: {
  policy: TurnPolicy
  activity: Pick<RuntimeSessionActivity, 'turnFailed' | 'holdFinalization'>
}): TurnPolicy => ({
  ...args.policy,
  onOutcome: async (request) => {
    const release = args.activity.holdFinalization(request)
    try {
      await args.policy.onOutcome(request)
    } finally {
      release()
    }
  },
  onCrashed: (request) => {
    args.activity.turnFailed(request)
    return args.policy.onCrashed(request)
  },
})

export function bindActivity(args: {
  container: DependencyContainer
  channel: DeltaChannel
}): RuntimeSessionActivity {
  const { container, channel } = args
  const agents = container.resolve(registeredPortToken(AgentRegistryPort))
  const shells = container.resolve(registeredPortToken(ShellRegistryPort))
  const activity = new RuntimeSessionActivity({
    log: container.resolve(registeredPortToken(EventLogPort)),
    input: container.resolve(registeredPortToken(OperatorInputPort)),
    channel,
    roster: {
      read: async ({ threadId }) => {
        await agents.hydrate({ threadId })
        return { agents: [...agents.list({ threadId })], shells: [...shells.list({ threadId })] }
      },
      subscribe: (listener) => {
        const detachAgents = agents.onChange(listener)
        const detachShells = shells.subscribe(listener)
        return () => {
          detachAgents()
          detachShells()
        }
      },
    },
  })
  container.register(registeredPortToken(SessionActivityPort), { useValue: activity })
  registerDisposable({ container, close: async () => activity.close() })
  return activity
}
