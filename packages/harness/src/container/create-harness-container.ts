import {
  ClockPort,
  CredentialAvailabilityPort,
  EExecutionLocation,
  EventLogPort,
  FileCapabilitiesPort,
  IdPort,
  LogPort,
  ModelPort,
  QualityReviewPort,
  TelemetryPort,
  telemetryEnabled,
  ThreadReadCursorPort,
} from '@dltech/atlas-core'

import {
  createExecutionLocationState,
  ExecutionLocationToken,
} from '../composition/execution-location-state'

import { restoreArchivedLocalFiles } from '../cloud/local-recovery'
import { InMemoryCredentialAvailability } from '../credentials/credential-availability'
import { registerBuiltinHooks } from '../hooks/register-hooks'
import { TurnLedgerPort } from '../ledger'
import { JsonlTurnLedger } from '../ledger/jsonl'
import { resolveHookChain } from '../hooks/resolve-hooks'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { CardFileCapabilities } from '../tools/builtin/file-capabilities'
import { createRawTape } from '../model/raw-tape'
import { registerFileState } from '../files'
import { registerSaidUploads } from '../uploads/register-said-uploads'
import { registerExecution } from '../execution/register-execution'
import { registerChanges } from '../changes/register-changes'
import { registerServices } from '../services/register-services'
import { registerOperatorInput } from '../operator-input/register-operator-input'
import { registerTerminal } from '../terminal/register-terminal'
import { registerShells } from '../shells/register-shells'
import { registerSkills } from '../skills/register-skills'
import { ThreadStorePort, RandomIds, SystemClock } from '../store'
import { JsonlLog } from '../store/logs'
import { atlasDirectory } from '../store/paths'
import { JsonlEventLog } from '../store/sessions/event-log'
import { FileThreadReadCursor } from '../store/sessions/read-cursor'
import { registryFor } from '../store/sessions/registry'
import { SessionAuthorityPort } from '../store/sessions/meta'
import { JsonlSessionAuthority } from '../store/sessions/session-authority'
import { JsonlThreadStore } from '../store/sessions/thread-store'
import { NullTelemetry } from '../telemetry/null-telemetry'
import { ObservingToolDispatcher } from '../telemetry/observing-dispatcher'
import { PosthogTelemetry } from '../telemetry/posthog-telemetry'
import { telemetryDistinctId } from '../telemetry/identity'
import { HookedToolDispatcher, ToolDispatcher } from '../tools/dispatch'
import { registerBuiltinTools } from '../tools/register-tools'
import { ToolRegistry } from '../tools/registry'
import { clientVersionOf } from './client-version'
import { registerDisposable } from './disposal'
import { registerAgents } from './register-agents'
import { registerCloudStores } from './register-cloud-stores'
import { registerCloudManagedCredentials } from './register-cloud-managed-credentials'
import {
  createIsolatedContainer,
  instanceCachingFactory,
  registeredPortToken,
  type DependencyContainer,
} from './injection'
import {
  HookChainToken,
  LanguageModelToken,
  ModelCardSourceToken,
  SessionRegistryToken,
  AtlasHomeToken,
  WakeSignalToken,
  WorkspaceRoot,
} from './tokens'

export { ChildRunnerDepsToken } from './register-agents'

export function createHarnessContainer(): DependencyContainer {
  const harness = createIsolatedContainer()

  const tape = createRawTape({ scope: `pid-${process.pid}` })
  registerDisposable({ container: harness, close: () => tape.close() })

  restoreArchivedLocalFiles()

  const home = atlasDirectory()
  harness.register(AtlasHomeToken, { useValue: home })
  harness.register(SessionRegistryToken, { useValue: registryFor({ home }) })
  harness.register(registeredPortToken(SessionAuthorityPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new JsonlSessionAuthority({
          registry: resolver.resolve(SessionRegistryToken),
        }),
    ),
  })

  harness.register(registeredPortToken(ClockPort), { useClass: SystemClock })
  harness.register(registeredPortToken(IdPort), { useClass: RandomIds })
  harness.register(registeredPortToken(CredentialAvailabilityPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new InMemoryCredentialAvailability({
          clock: resolver.resolve(registeredPortToken(ClockPort)),
        }),
    ),
  })
  harness.register(registeredPortToken(TelemetryPort), {
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
  harness.register(registeredPortToken(EventLogPort), {
    useFactory: (resolver) =>
      new JsonlEventLog(
        home,
        resolver.resolve(SessionRegistryToken),
        resolver.resolve(registeredPortToken(ClockPort)),
        resolver.resolve(registeredPortToken(IdPort)),
      ),
  })
  harness.register(registeredPortToken(ThreadReadCursorPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new FileThreadReadCursor({
          registry: resolver.resolve(SessionRegistryToken),
          log: resolver.resolve(registeredPortToken(EventLogPort)),
        }),
    ),
  })
  harness.register(registeredPortToken(TurnLedgerPort), {
    useFactory: (resolver) =>
      new JsonlTurnLedger({ home, registry: resolver.resolve(SessionRegistryToken) }),
  })
  harness.register(registeredPortToken(LogPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new JsonlLog({
          home,
          registry: resolver.resolve(SessionRegistryToken),
          clock: resolver.resolve(registeredPortToken(ClockPort)),
        }),
    ),
  })
  harness.register(registeredPortToken(ThreadStorePort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new JsonlThreadStore(
          home,
          resolver.resolve(SessionRegistryToken),
          resolver.resolve(registeredPortToken(ClockPort)),
          resolver.resolve(registeredPortToken(IdPort)),
          resolver.resolve(registeredPortToken(EventLogPort)),
          resolver.resolve(registeredPortToken(LogPort)),
        ),
    ),
  })
  registerCloudStores({ container: harness, clientVersion: clientVersionOf })

  registerCloudManagedCredentials({ container: harness, clientVersion: clientVersionOf })

  registerFileState({ container: harness })
  registerSaidUploads({ container: harness })
  registerExecution({ container: harness })
  registerShells({ container: harness })
  registerServices({ container: harness })
  registerChanges({ container: harness })
  registerTerminal({ container: harness })
  registerOperatorInput({ container: harness })
  registerSkills({ container: harness })
  registerAgents({ container: harness })
  harness.register(ExecutionLocationToken, {
    useFactory: instanceCachingFactory((resolver) => {
      const state = createExecutionLocationState({ initial: EExecutionLocation.Host })
      state.bind({
        threads: resolver.resolve(registeredPortToken(ThreadStorePort)),
        workspace: resolver.isRegistered(WorkspaceRoot, true)
          ? resolver.resolve(WorkspaceRoot)
          : home,
        repo: null,
        authority: resolver.isRegistered(registeredPortToken(SessionAuthorityPort), true)
          ? resolver.resolve(registeredPortToken(SessionAuthorityPort))
          : undefined,
      })
      return { state, pinned: false }
    }),
  })
  registerBuiltinTools({ container: harness })
  registerBuiltinHooks({ container: harness })

  harness.register(HookChainToken, {
    useFactory: instanceCachingFactory((resolver) => resolveHookChain({ container: resolver })),
  })

  harness.register(registeredPortToken(ToolDispatcher), {
    useFactory: (resolver) =>
      new ObservingToolDispatcher({
        inner: new HookedToolDispatcher({
          registry: resolver.resolve(registeredPortToken(ToolRegistry)),
          hooks: resolver.resolve(HookChainToken),
          logPort: resolver.resolve(registeredPortToken(LogPort)),
          quality: resolver.isRegistered(registeredPortToken(QualityReviewPort), true)
            ? resolver.resolve(registeredPortToken(QualityReviewPort))
            : undefined,
        }),
        telemetry: resolver.resolve(registeredPortToken(TelemetryPort)),
      }),
  })

  harness.register(registeredPortToken(FileCapabilitiesPort), {
    useFactory: (resolver) =>
      new CardFileCapabilities({
        ...(resolver.isRegistered(ModelCardSourceToken, true)
          ? { card: resolver.resolve(ModelCardSourceToken) }
          : {}),
      }),
  })

  harness.register(registeredPortToken(ModelPort), {
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
