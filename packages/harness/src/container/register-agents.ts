import {
  ClockPort,
  EDefinitionOrigin,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  LogPort,
  NoopExecutionLocationSink,
  TelemetryPort,
} from '@dltech/atlas-core'

import { childRunnerSource, type ChildRunnerDepsSource } from '../agents/registry/child-runner'
import { leftServicesOf } from '../agents/registry/left-services'
import { AgentRegistryPort } from '../agents/registry/port'
import { endShellsOf, runningShellOf } from '../agents/registry/running-shell'
import { AgentSupervisor } from '../agents/registry/supervisor'
import type { AgentType } from '../agents/types/agent-type'
import { BUILT_IN_AGENT_TYPES } from '../agents/types/built-ins'
import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { releaseEndedWorktree } from '../composition/worktree-claims'
import { ModelWaitState } from '../model-recovery/wait-state'
import { ModelWaitStateToken } from '../model-recovery/wait-state-token'
import { ShellRegistryPort } from '../shells/shell-registry'
import { ServiceRegistryPort } from '../services/service-registry'
import { ThreadStorePort } from '../store'
import { AgentRegistrySourceToken, AgentTypesToken } from '../tools/builtin/agent-tokens'
import { registerDisposable } from './disposal'
import {
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
  type InjectionToken,
} from './injection'
import { DeltaChannelToken, WorkspaceRoot } from './tokens'

export const ChildRunnerDepsToken: InjectionToken<ChildRunnerDepsSource> =
  Symbol('atlas.ChildRunnerDeps')

const optionalLog = (resolver: DependencyContainer): LogPort | undefined =>
  resolver.isRegistered(registeredPortToken(LogPort), true)
    ? resolver.resolve(registeredPortToken(LogPort))
    : undefined

const embeddedAgentTypes = (): readonly AgentType[] =>
  BUILT_IN_AGENT_TYPES.map((agentType) => ({ ...agentType, origin: EDefinitionOrigin.BuiltIn }))

const publishingLog = ({
  container,
  resolver,
}: {
  container: DependencyContainer
  resolver: DependencyContainer
}): EventLogPort =>
  withEventsAppendedPublishing({
    log: resolver.resolve(registeredPortToken(EventLogPort)),
    channel: () =>
      container.isRegistered(DeltaChannelToken, true)
        ? container.resolve(DeltaChannelToken)
        : undefined,
    onListenerError: (cause) =>
      optionalLog(resolver)?.warn({
        source: 'agents.publication',
        message: 'a channel listener threw on an events-appended publication',
        error: cause instanceof Error ? cause.message : String(cause),
      }),
  })

export function registerAgents({ container }: { container: DependencyContainer }): void {
  let live: AgentSupervisor | undefined

  container.register(ModelWaitStateToken, {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new ModelWaitState({
          log: publishingLog({ container, resolver }),
          ids: resolver.resolve(registeredPortToken(IdPort)),
          threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
        }),
    ),
  })

  container.register(AgentTypesToken, { useValue: embeddedAgentTypes() })

  container.register(registeredPortToken(ExecutionLocationSinkPort), {
    useClass: NoopExecutionLocationSink,
  })

  container.register(registeredPortToken(AgentRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      live = new AgentSupervisor({
        log: publishingLog({ container, resolver }),
        waitState: resolver.resolve(ModelWaitStateToken),
        threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
        ids: resolver.resolve(registeredPortToken(IdPort)),
        clock: resolver.resolve(registeredPortToken(ClockPort)),
        agentTypes: resolver.resolve(AgentTypesToken),
        runners: childRunnerSource({ deps: () => resolver.resolve(ChildRunnerDepsToken)() }),
        modelAtSpawn: async (args) =>
          resolver.isRegistered(ChildRunnerDepsToken, true)
            ? resolver.resolve(ChildRunnerDepsToken)().modelAtSpawn?.(args)
            : undefined,
        launchDirectory: resolver.resolve(WorkspaceRoot),
        sink: resolver.resolve(registeredPortToken(ExecutionLocationSinkPort)),
        telemetry: resolver.resolve(registeredPortToken(TelemetryPort)),
        input: () => {
          if (!resolver.isRegistered(ChildRunnerDepsToken, true)) return undefined
          return resolver.resolve(ChildRunnerDepsToken)().intake
        },
        runningShell: (threadId) =>
          runningShellOf({
            threadId,
            shells: resolver.resolve(registeredPortToken(ShellRegistryPort)),
          }),
        endShells: ({ threadId, by }) =>
          endShellsOf({
            threadId,
            by,
            shells: resolver.resolve(registeredPortToken(ShellRegistryPort)),
          }),
        leftServices: (threadId) =>
          leftServicesOf({
            threadId,
            services: resolver.resolve(registeredPortToken(ServiceRegistryPort)),
          }),
        inheritOrphanedNotices: ({ from, to }) => {
          resolver.resolve(registeredPortToken(ShellRegistryPort)).reassignNotices({ from, to })
          resolver.resolve(registeredPortToken(ServiceRegistryPort)).reassignNotices({ from, to })
        },
        onChildEnded: (threadId) => {
          void releaseEndedWorktree({
            threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
            log: resolver.resolve(registeredPortToken(EventLogPort)),
            threadId,
          }).catch(() => undefined)
        },
      })
      return live
    }),
  })

  container.register(AgentRegistrySourceToken, {
    useValue: () => container.resolve(registeredPortToken(AgentRegistryPort)),
  })

  registerDisposable({
    container,
    close: async () => {
      await live?.closeAll()
    },
  })
}
