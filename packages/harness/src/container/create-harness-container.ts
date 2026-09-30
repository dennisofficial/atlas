import {
  AccountStorePort,
  ClockPort,
  CredentialPort,
  EDefinitionOrigin,
  EExecutionLocation,
  EventLogPort,
  ExecutionLocationSinkPort,
  FileCapabilitiesPort,
  IdPort,
  LogPort,
  ModelPort,
  NoopExecutionLocationSink,
  TelemetryPort,
  telemetryEnabled,
} from '@dltech/atlas-core'

import {
  createExecutionLocationState,
  ExecutionLocationToken,
} from '../composition/execution-location-state'

import { childRunnerSource, type ChildRunnerDepsSource } from '../agents/registry/child-runner'
import type { IntakeSubmit } from '../agents/registry/deps'
import { AgentRegistryPort } from '../agents/registry/port'
import { AgentSupervisor } from '../agents/registry/supervisor'
import type { AgentType } from '../agents/types/agent-type'
import { BUILT_IN_AGENT_TYPES } from '../agents/types/built-ins'
import { restoreArchivedLocalFiles } from '../cloud/local-recovery'
import { ClaudeCodeSource, claudeCodePayloadStore } from '../credentials/claude-code-source'
import { CodexSource } from '../credentials/codex-source'
import { fileAccountStore } from '../credentials/account-store'
import { builtinOauthClients } from '../credentials/oauth'
import { atlasVaultFile, atlasVaultKeyFile } from '../credentials/paths'
import { SecretCipher } from '../credentials/secret-cipher'
import { FileSecretsStore } from '../secrets/file-secrets-store'
import { atlasSecretsFile } from '../secrets/paths'
import { RefreshingCredentialPort } from '../credentials/refreshing-credential-port'
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
import { registerShells } from '../shells/register-shells'
import { registerSkills } from '../skills/register-skills'
import { ThreadStorePort, RandomIds, SystemClock } from '../store'
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
import {
  createIsolatedContainer,
  instanceCachingFactory,
  portToken,
  type DependencyContainer,
  type InjectionToken,
} from './injection'
import {
  ClaudeCodeSourceToken,
  ClientVersionToken,
  CodexSourceToken,
  HookChainToken,
  KeychainReaderToken,
  LanguageModelToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  ModelCardSourceToken,
  SecretsStoreToken,
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
  let live: AgentRegistryPort | undefined

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
  // The store holds listener state (onRename, onModelChosen), so a session must get exactly one
  // instance: a second resolve would hand the titler a store whose rename echo reaches nobody,
  // which is precisely the live bug the titling trace caught (store rename, listeners=0).
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

  harness.register(LocalAccountStoreToken, {
    useFactory: instanceCachingFactory(
      (resolver) =>
        fileAccountStore({
          file: atlasVaultFile(),
          keyFile: atlasVaultKeyFile(),
          clock: resolver.resolve(portToken(ClockPort)),
        }),
    ),
  })
  harness.register(portToken(AccountStorePort), {
    useFactory: instanceCachingFactory((resolver) => resolver.resolve(LocalAccountStoreToken)),
  })

  harness.register(LocalSecretsStoreToken, {
    useFactory: instanceCachingFactory(
      () =>
        new FileSecretsStore({
          file: atlasSecretsFile(),
          cipher: new SecretCipher(atlasVaultKeyFile()),
        }),
    ),
  })
  harness.register(SecretsStoreToken, {
    useFactory: instanceCachingFactory((resolver) => resolver.resolve(LocalSecretsStoreToken)),
  })

  harness.register(ClaudeCodeSourceToken, {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new ClaudeCodeSource(
          claudeCodePayloadStore({ reader: resolver.resolve(KeychainReaderToken) }),
        ),
    ),
  })

  harness.register(CodexSourceToken, {
    useFactory: instanceCachingFactory(() => new CodexSource()),
  })

  harness.register(portToken(CredentialPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const clock = resolver.resolve(portToken(ClockPort))
      return new RefreshingCredentialPort({
        accounts: resolver.resolve(portToken(AccountStorePort)),
        clients: builtinOauthClients({ clock }),
        clock,
        sinks: [resolver.resolve(ClaudeCodeSourceToken), resolver.resolve(CodexSourceToken)],
      })
    }),
  })

  registerFileState({ container: harness })
  registerExecution({ container: harness })
  registerShells({ container: harness })
  registerServices({ container: harness })
  registerSkills({ container: harness })
  registerAgents({ container: harness })
  // bindModels re-registers this with the session's real state; the default only exists so a
  // container that never binds models can still build the tool registry.
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
