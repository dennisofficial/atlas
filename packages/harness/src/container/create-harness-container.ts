import {
  AccountStorePort,
  ATLAS_SETTINGS,
  ClockPort,
  CredentialPort,
  EDefinitionOrigin,
  EExecutionLocation,
  ESettingId,
  ESettingsLayer,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  ModelPort,
  NoopExecutionLocationSink,
  resolveSettings,
  toggleValueOf,
  type SettingsLayerInput,
  type SettingsStorePort,
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
import { CloudSessionStore } from '../cloud/cloud-session'
import { CredentialPortProxy } from '../cloud/credential-port-proxy'
import { SecretsStoreProxy } from '../cloud/secrets-store-proxy'
import { ClaudeCodeSource, claudeCodePayloadStore } from '../credentials/claude-code-source'
import { fileAccountStore } from '../credentials/account-store'
import { builtinOauthClients } from '../credentials/oauth'
import { atlasCloudFile, atlasVaultFile, atlasVaultKeyFile } from '../credentials/paths'
import { SecretCipher } from '../credentials/secret-cipher'
import { FileSecretsStore } from '../secrets/file-secrets-store'
import { atlasSecretsFile } from '../secrets/paths'
import { BrokeredCredentialPort } from '../credentials/brokered-credential-port'
import { RefreshingCredentialPort } from '../credentials/refreshing-credential-port'
import { registerBuiltinHooks } from '../hooks/register-hooks'
import { PrismaTurnLedger, TurnLedgerPort } from '../ledger'
import { resolveHookChain } from '../hooks/resolve-hooks'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { createRawTape } from '../model/raw-tape'
import { registerFileState } from '../files'
import { environmentLayer } from '../settings/environment'
import { registerExecution } from '../execution/register-execution'
import { registerServices } from '../services/register-services'
import { registerShells } from '../shells/register-shells'
import { registerSkills } from '../skills/register-skills'
import { ThreadStorePort, PrismaThreadStore, PrismaEventLog, RandomIds, SystemClock } from '../store'
import { AgentRegistrySourceToken, AgentTypesToken } from '../tools/builtin/agent-tokens'
import { HookedToolDispatcher, ToolDispatcher } from '../tools/dispatch'
import { registerBuiltinTools } from '../tools/register-tools'
import { ToolRegistry } from '../tools/registry'
import { registerDisposable } from './disposal'
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
  CloudRequiredToken,
  CloudSessionStoreToken,
  HookChainToken,
  KeychainReaderToken,
  LanguageModelToken,
  LocalAccountStoreToken,
  LocalSecretsStoreToken,
  ModelCardSourceToken,
  PrismaClientToken,
  ProjectSettingsStoreToken,
  SecretsStoreToken,
  UserSettingsStoreToken,
  WorkspaceRoot,
} from './tokens'

export const ChildRunnerDepsToken: InjectionToken<ChildRunnerDepsSource> =
  Symbol('atlas.ChildRunnerDeps')

const clientVersionOf = (resolver: DependencyContainer): string =>
  resolver.isRegistered(ClientVersionToken, true) ? resolver.resolve(ClientVersionToken) : 'dev'

const liveCloudRequired =
  (resolver: DependencyContainer) => (): boolean =>
    resolver.isRegistered(CloudRequiredToken, true) ? resolver.resolve(CloudRequiredToken)() : false

const cloudRequiredDefault =
  (args: { container: DependencyContainer }): (() => boolean) =>
  (): boolean => {
    const stores: [InjectionToken<SettingsStorePort>, ESettingsLayer][] = [
      [UserSettingsStoreToken, ESettingsLayer.User],
      [ProjectSettingsStoreToken, ESettingsLayer.Project],
    ]
    const layers: SettingsLayerInput[] = []
    for (const [token, layer] of stores) {
      if (!args.container.isRegistered(token, true)) continue
      const store = args.container.resolve(token)
      layers.push({ layer, origin: store.origin(), values: store.read().document.values })
    }
    layers.push(environmentLayer({ definitions: ATLAS_SETTINGS, env: process.env }))

    return toggleValueOf({
      resolution: resolveSettings({ definitions: ATLAS_SETTINGS, layers }),
      id: ESettingId.CloudRequired,
    })
  }

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

  harness.register(portToken(ClockPort), { useClass: SystemClock })
  harness.register(portToken(IdPort), { useClass: RandomIds })
  harness.register(portToken(EventLogPort), {
    useFactory: (resolver) =>
      new PrismaEventLog(
        resolver.resolve(PrismaClientToken),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(portToken(IdPort)),
      ),
  })
  harness.register(portToken(TurnLedgerPort), {
    useFactory: (resolver) => new PrismaTurnLedger(resolver.resolve(PrismaClientToken)),
  })
  harness.register(portToken(ThreadStorePort), {
    useFactory: (resolver) =>
      new PrismaThreadStore(
        resolver.resolve(PrismaClientToken),
        resolver.resolve(portToken(ClockPort)),
        resolver.resolve(portToken(IdPort)),
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

  harness.register(CloudSessionStoreToken, {
    useFactory: instanceCachingFactory(
      () => new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() }),
    ),
  })

  harness.register(CloudRequiredToken, {
    useValue: cloudRequiredDefault({ container: harness }),
  })

  harness.register(portToken(AccountStorePort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new AccountStoreProxy({
          local: resolver.resolve(LocalAccountStoreToken),
          sessions: resolver.resolve(CloudSessionStoreToken),
          clientVersion: clientVersionOf(resolver),
          cloudRequired: liveCloudRequired(resolver),
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
          cloudRequired: liveCloudRequired(resolver),
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
          sinks: [resolver.resolve(ClaudeCodeSourceToken)],
        }),
        brokered: new BrokeredCredentialPort({
          accounts,
          sessions,
          clock,
          clientVersion: clientVersionOf(resolver),
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
