import {
  ClockPort,
  CredentialPort,
  EDefinitionOrigin,
  EExecutionLocation,
  EServiceStatus,
  EventLogPort,
  ExecutionLocationSinkPort,
  FileCapabilitiesPort,
  IdPort,
  LogPort,
  ModelPort,
  NoopExecutionLocationSink,
  QualityReviewPort,
  TelemetryPort,
  telemetryEnabled,
} from '@dltech/atlas-core'

import {
  createExecutionLocationState,
  ExecutionLocationToken,
} from '../composition/execution-location-state'

import { childRunnerSource, type ChildRunnerDepsSource } from '../agents/registry/child-runner'
import { isStepping } from '../agents/registry/child-state'
import type { IntakeSubmit } from '../agents/registry/deps'
import { AgentRegistryPort } from '../agents/registry/port'
import { AgentSupervisor } from '../agents/registry/supervisor'
import type { AgentType } from '../agents/types/agent-type'
import { BUILT_IN_AGENT_TYPES } from '../agents/types/built-ins'
import { restoreArchivedLocalFiles } from '../cloud/local-recovery'
import { registerBuiltinHooks } from '../hooks/register-hooks'
import { TurnLedgerPort } from '../ledger'
import { JsonlTurnLedger } from '../ledger/jsonl'
import { resolveHookChain } from '../hooks/resolve-hooks'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { CardFileCapabilities } from '../tools/builtin/file-capabilities'
import { createRawTape } from '../model/raw-tape'
import { registerFileState } from '../files'
import { registerExecution } from '../execution/register-execution'
import { registerServices } from '../services/register-services'
import { ServiceRegistryPort } from '../services/service-registry'
import { registerOperatorInput } from '../operator-input/register-operator-input'
import { registerShells } from '../shells/register-shells'
import { EShellStatus } from '../shells/background-shell'
import { ShellRegistryPort } from '../shells/shell-registry'
import { registerSkills } from '../skills/register-skills'
import { ThreadStorePort, RandomIds, SystemClock } from '../store'
import { releaseEndedWorktree } from '../composition/worktree-claims'
import { JsonlLog } from '../store/logs'
import { atlasDirectory } from '../store/paths'
import { JsonlEventLog } from '../store/sessions/event-log'
import { registryFor } from '../store/sessions/registry'
import { JsonlThreadStore } from '../store/sessions/thread-store'
import { AgentRegistrySourceToken, AgentTypesToken } from '../tools/builtin/agent-tokens'
import { NullTelemetry } from '../telemetry/null-telemetry'
import { ObservingToolDispatcher } from '../telemetry/observing-dispatcher'
import { PosthogTelemetry } from '../telemetry/posthog-telemetry'
import { telemetryDistinctId } from '../telemetry/identity'
import { HookedToolDispatcher, ToolDispatcher } from '../tools/dispatch'
import { registerBuiltinTools } from '../tools/register-tools'
import { ToolRegistry } from '../tools/registry'
import { registerDisposable } from './disposal'
import { registerCloudStores } from './register-cloud-stores'
import { registerCloudManagedCredentials } from './register-cloud-managed-credentials'
import {
  createIsolatedContainer,
  instanceCachingFactory,
  portToken,
  type DependencyContainer,
  type InjectionToken,
} from './injection'
import {
  ClientVersionToken,
  HookChainToken,
  LanguageModelToken,
  ModelCardSourceToken,
  SessionRegistryToken,
  AtlasHomeToken,
  WakeSignalToken,
  WorkspaceRoot,
} from './tokens'

export const ChildRunnerDepsToken: InjectionToken<ChildRunnerDepsSource> =
  Symbol('atlas.ChildRunnerDeps')

const clientVersionOf = (resolver: DependencyContainer): string =>
  resolver.isRegistered(ClientVersionToken, true) ? resolver.resolve(ClientVersionToken) : 'dev'

const embeddedAgentTypes = (): readonly AgentType[] =>
  BUILT_IN_AGENT_TYPES.map((agentType) => ({ ...agentType, origin: EDefinitionOrigin.BuiltIn }))

function registerAgents({ container }: { container: DependencyContainer }): void {
  let live: AgentSupervisor | undefined

  container.register(AgentTypesToken, { useValue: embeddedAgentTypes() })

  container.register(portToken(ExecutionLocationSinkPort), { useClass: NoopExecutionLocationSink })

  container.register(portToken(AgentRegistryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      live = new AgentSupervisor({
        log: resolver.resolve(portToken(EventLogPort)),
        threads: resolver.resolve(portToken(ThreadStorePort)),
        ids: resolver.resolve(portToken(IdPort)),
        clock: resolver.resolve(portToken(ClockPort)),
        agentTypes: resolver.resolve(AgentTypesToken),
        runners: childRunnerSource({ deps: () => resolver.resolve(ChildRunnerDepsToken)() }),
        modelAtSpawn: async (args) => resolver.isRegistered(ChildRunnerDepsToken, true)
          ? resolver.resolve(ChildRunnerDepsToken)().modelAtSpawn?.(args)
          : undefined,
        launchDirectory: resolver.resolve(WorkspaceRoot),
        sink: resolver.resolve(portToken(ExecutionLocationSinkPort)),
        telemetry: resolver.resolve(portToken(TelemetryPort)),
        input: () => {
          if (!resolver.isRegistered(ChildRunnerDepsToken, true)) return undefined
          return resolver.resolve(ChildRunnerDepsToken)().intake
        },
        hasLiveWork: (threadId) => {
          if (live === undefined) return false
          const shells = resolver.resolve(portToken(ShellRegistryPort))
          if (shells.list({ threadId }).some((shell) => shell.status === EShellStatus.Running)) return true
          const services = resolver.resolve(portToken(ServiceRegistryPort))
          if (services.list().some((service) => service.status === EServiceStatus.Running)) return true
          return live.someChild(threadId, isStepping)
        },
        onChildEnded: (threadId) => {
          void releaseEndedWorktree({
            threads: resolver.resolve(portToken(ThreadStorePort)),
            threadId,
          }).catch(() => undefined)
        },
      })
      return live
    }),
  })

  container.register(AgentRegistrySourceToken, {
    useValue: () => container.resolve(portToken(AgentRegistryPort)),
  })

  registerDisposable({
    container,
    close: async () => {
      await live?.closeAll()
    },
  })
}

export function createHarnessContainer(): DependencyContainer {
  const harness = createIsolatedContainer()

  const tape = createRawTape({ scope: `pid-${process.pid}` })
  registerDisposable({ container: harness, close: () => tape.close() })

  restoreArchivedLocalFiles()

  const home = atlasDirectory()
  harness.register(AtlasHomeToken, { useValue: home })
  harness.register(SessionRegistryToken, { useValue: registryFor({ home }) })

  harness.register(portToken(ClockPort), { useClass: SystemClock })
  harness.register(portToken(IdPort), { useClass: RandomIds })
  harness.register(portToken(TelemetryPort), {
    useFactory: instanceCachingFactory((resolver) => {
      if (!telemetryEnabled(process.env)) return new NullTelemetry()
      try {
        return new PosthogTelemetry({
          distinctId: telemetryDistinctId({ atlasHome: home, env: process.env }),
          version: clientVersionOf(resolver),
        })
      } catch {
        return new NullTelemetry()
      }
    }),
  })
  harness.register(portToken(EventLogPort), {
    useFactory: (resolver) =>
      new JsonlEventLog(
        home,
        resolver.resolve(SessionRegistryToken),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(portToken(IdPort)),
      ),
  })
  harness.register(portToken(TurnLedgerPort), {
    useFactory: (resolver) =>
      new JsonlTurnLedger({ home, registry: resolver.resolve(SessionRegistryToken) }),
  })
  harness.register(portToken(LogPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new JsonlLog({
          home,
          registry: resolver.resolve(SessionRegistryToken),
          clock: resolver.resolve(portToken(ClockPort)),
        }),
    ),
  })
  harness.register(portToken(ThreadStorePort), {
    useFactory: instanceCachingFactory((resolver) =>
      new JsonlThreadStore(
        home,
        resolver.resolve(SessionRegistryToken),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(portToken(IdPort)),
        resolver.resolve(portToken(EventLogPort)),
        resolver.resolve(portToken(LogPort)),
      ),
    ),
  })
  registerCloudStores({ container: harness, clientVersion: clientVersionOf })

  registerCloudManagedCredentials({ container: harness, clientVersion: clientVersionOf })

  registerFileState({ container: harness })
  registerExecution({ container: harness })
  registerShells({ container: harness })
  registerServices({ container: harness })
  registerOperatorInput({ container: harness })
  registerSkills({ container: harness })
  registerAgents({ container: harness })
  harness.register(ExecutionLocationToken, {
    useFactory: instanceCachingFactory((resolver) => {
      const state = createExecutionLocationState({ initial: EExecutionLocation.Host })
      state.bind({
        threads: resolver.resolve(portToken(ThreadStorePort)),
        workspace: resolver.isRegistered(WorkspaceRoot, true) ? resolver.resolve(WorkspaceRoot) : home,
        repo: null,
      })
      return { state, pinned: false }
    }),
  })
  registerBuiltinTools({ container: harness })
  registerBuiltinHooks({ container: harness })

  harness.register(HookChainToken, {
    useFactory: instanceCachingFactory((resolver) => resolveHookChain({ container: resolver })),
  })

  harness.register(portToken(ToolDispatcher), {
    useFactory: (resolver) =>
      new ObservingToolDispatcher({
        inner: new HookedToolDispatcher({
          registry: resolver.resolve(portToken(ToolRegistry)),
          hooks: resolver.resolve(HookChainToken),
          logPort: resolver.resolve(portToken(LogPort)),
          quality: resolver.isRegistered(portToken(QualityReviewPort), true)
            ? resolver.resolve(portToken(QualityReviewPort)) : undefined,
        }),
        telemetry: resolver.resolve(portToken(TelemetryPort)),
      }),
  })

  harness.register(portToken(FileCapabilitiesPort), {
    useFactory: (resolver) =>
      new CardFileCapabilities({
        ...(resolver.isRegistered(ModelCardSourceToken, true)
          ? { card: resolver.resolve(ModelCardSourceToken) }
          : {}),
      }),
  })

  harness.register(portToken(ModelPort), {
    useFactory: (resolver) => {
      const model = resolver.resolve(LanguageModelToken)
      const card = resolver.isRegistered(ModelCardSourceToken, true)
        ? resolver.resolve(ModelCardSourceToken)
        : undefined
      return new AiSdkModelPort({
        model,
        ...(card === undefined ? {} : { card }),
        hooks: resolver.resolve(HookChainToken),
        tape,
        ...(resolver.isRegistered(WakeSignalToken, true)
          ? { wake: resolver.resolve(WakeSignalToken) }
          : {}),
      })
    },
  })

  return harness
}
