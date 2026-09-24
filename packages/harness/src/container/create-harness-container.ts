import {
  AccountStorePort,
  ClockPort,
  CredentialPort,
  EDefinitionOrigin,
  EExecutionLocation,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  ModelPort,
  NoopExecutionLocationSink,
} from '@dltech/atlas-core'

import {
  createExecutionLocationState,
  ExecutionLocationToken,
} from '../composition/execution-location-state'

import { childRunnerSource, type ChildRunnerDepsSource } from '../agents/registry/child-runner'
import { AgentRegistryPort } from '../agents/registry/port'
import { AgentSupervisor } from '../agents/registry/supervisor'
import type { AgentType } from '../agents/types/agent-type'
import { BUILT_IN_AGENT_TYPES } from '../agents/types/built-ins'
import { AccountStoreProxy } from '../cloud/account-store-proxy'
import { CredentialPortProxy } from '../cloud/credential-port-proxy'
import { SecretsStoreProxy } from '../cloud/secrets-store-proxy'
import { ClaudeCodeSource, claudeCodePayloadStore } from '../credentials/claude-code-source'
import { CodexSource } from '../credentials/codex-source'
import { fileAccountStore } from '../credentials/account-store'
import { builtinOauthClients } from '../credentials/oauth'
import { atlasVaultFile, atlasVaultKeyFile } from '../credentials/paths'
import { SecretCipher } from '../credentials/secret-cipher'
import { FileSecretsStore } from '../secrets/file-secrets-store'
import { atlasSecretsFile } from '../secrets/paths'
import { BrokeredCredentialPort } from '../credentials/brokered-credential-port'
import { RefreshingCredentialPort } from '../credentials/refreshing-credential-port'
import { registerBuiltinHooks } from '../hooks/register-hooks'
import { TurnLedgerPort } from '../ledger'
import { JsonlTurnLedger } from '../ledger/jsonl'
import { resolveHookChain } from '../hooks/resolve-hooks'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { createRawTape } from '../model/raw-tape'
import { registerFileState } from '../files'
import { registerExecution } from '../execution/register-execution'
import { registerServices } from '../services/register-services'
import { registerShells } from '../shells/register-shells'
import { registerSkills } from '../skills/register-skills'
import { ThreadStorePort, RandomIds, SystemClock } from '../store'
import { atlasDirectory } from '../store/paths'
import { JsonlEventLog } from '../store/sessions/event-log'
import { registryFor } from '../store/sessions/registry'
import { JsonlThreadStore } from '../store/sessions/thread-store'
import { AgentRegistrySourceToken, AgentTypesToken } from '../tools/builtin/agent-tokens'
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
  CloudSessionStoreToken,
  CloudSettingsStoreToken,
  CodexSourceToken,
  HookChainToken,
  KeychainReaderToken,
  LanguageModelToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  ModelCardSourceToken,
  SecretsStoreToken,
  SessionRegistryToken,
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
        launchDirectory: resolver.resolve(WorkspaceRoot),
        sink: resolver.resolve(portToken(ExecutionLocationSinkPort)),
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

  const home = atlasDirectory()
  harness.register(SessionRegistryToken, { useValue: registryFor({ home }) })

  harness.register(portToken(ClockPort), { useClass: SystemClock })
  harness.register(portToken(IdPort), { useClass: RandomIds })
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
  harness.register(portToken(ThreadStorePort), {
    useFactory: (resolver) =>
      new JsonlThreadStore(
        home,
        resolver.resolve(SessionRegistryToken),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(portToken(IdPort)),
        resolver.resolve(portToken(EventLogPort)),
      ),
  })
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

  registerCloudStores({ container: harness, clientVersion: clientVersionOf })

  harness.register(portToken(AccountStorePort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new AccountStoreProxy({
          local: resolver.resolve(LocalAccountStoreToken),
          sessions: resolver.resolve(CloudSessionStoreToken),
          clientVersion: clientVersionOf(resolver),
          clock: resolver.resolve(portToken(ClockPort)),
        }),
    ),
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
    useFactory: instanceCachingFactory(
      (resolver) =>
        new SecretsStoreProxy({
          local: resolver.resolve(LocalSecretsStoreToken),
          sessions: resolver.resolve(CloudSessionStoreToken),
          clientVersion: clientVersionOf(resolver),
        }),
    ),
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
      const accounts = resolver.resolve(portToken(AccountStorePort))
      const sessions = resolver.resolve(CloudSessionStoreToken)

      return new CredentialPortProxy({
        sessions,
        local: new RefreshingCredentialPort({
          accounts,
          clients: builtinOauthClients({ clock }),
          clock,
          sinks: [resolver.resolve(ClaudeCodeSourceToken), resolver.resolve(CodexSourceToken)],
        }),
        brokered: new BrokeredCredentialPort({
          accounts,
          sessions,
          clock,
          clientVersion: clientVersionOf(resolver),
          onCredentialsRefused: () => {
            resolver.resolve(CloudSettingsStoreToken).invalidate()
            const store = resolver.resolve(portToken(AccountStorePort))
            if (store instanceof AccountStoreProxy) store.invalidate()
          },
        }),
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
    useValue: {
      state: createExecutionLocationState({ initial: EExecutionLocation.Host }),
      pinned: false,
    },
  })
  registerBuiltinTools({ container: harness })
  registerBuiltinHooks({ container: harness })

  harness.register(HookChainToken, {
    useFactory: instanceCachingFactory((resolver) => resolveHookChain({ container: resolver })),
  })

  harness.register(portToken(ToolDispatcher), {
    useFactory: (resolver) =>
      new HookedToolDispatcher({
        registry: resolver.resolve(portToken(ToolRegistry)),
        hooks: resolver.resolve(HookChainToken),
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
      })
    },
  })

  return harness
}
