import type { AccountStorePort } from './account-store.port'
import type { AgentFileSystemPort } from './agent-filesystem.port'
import type { ClockPort } from './clock.port'
import type { CredentialPort } from './credential.port'
import type { DecisionPort } from './decision.port'
import type { EventLogPort } from './event-log.port'
import type { ExecutionLocationSinkPort } from './execution-location-sink.port'
import type { FileCapabilitiesPort } from './file-capabilities.port'
import type { FileSystemPort } from './filesystem.port'
import type { IdPort } from './id.port'
import type { JudgePort } from './judge.port'
import type { LogPort } from './log.port'
import type { ModelPort } from './model.port'
import type { NoticePort } from './notice.port'
import type { ProcessPort } from './process.port'
import type { QualityReviewPort } from './quality-review.port'
import type { TelemetryPort } from './telemetry.port'
import type { WorkspaceFactsPort } from './workspace-facts.port'
import type { WorkspaceIdentityPort } from './workspace-identity.port'
import type { WorkspacePort } from './workspace.port'

/** The type of a port class: an abstract constructor of the port's instance type. */
export type PortContractShape<T> = abstract new (...args: never[]) => T

export type PortTransport = 'detached' | 'none'

export type PortRegistryEntry<T = unknown> = {
  readonly contract: PortContractShape<T>
  /**
   * 'detached' — the port reaches a detached client, so a remote adapter contract is required.
   * 'none' — the port is in-process by design; the empty transport slot is declared, never omitted.
   */
  readonly transport: PortTransport
}

/**
 * Every session port that exists, keyed by contract name. A port joins the registry only by an
 * entry here: ports defined in core are declared below, and harness-defined ports extend this
 * interface through declaration merging. `registeredPortToken` produces a resolvable token only
 * for contracts the registry names, so an unregistered port cannot be composed.
 */
export interface PortRegistryEntries {
  readonly ClockPort: PortRegistryEntry<ClockPort> & { readonly transport: 'none' }
  readonly IdPort: PortRegistryEntry<IdPort> & { readonly transport: 'none' }
  readonly TelemetryPort: PortRegistryEntry<TelemetryPort> & { readonly transport: 'none' }
  readonly EventLogPort: PortRegistryEntry<EventLogPort> & { readonly transport: 'detached' }
  readonly LogPort: PortRegistryEntry<LogPort> & { readonly transport: 'none' }
  readonly ModelPort: PortRegistryEntry<ModelPort> & { readonly transport: 'none' }
  readonly CredentialPort: PortRegistryEntry<CredentialPort> & { readonly transport: 'none' }
  readonly AccountStorePort: PortRegistryEntry<AccountStorePort> & {
    readonly transport: 'detached'
  }
  readonly ProcessPort: PortRegistryEntry<ProcessPort> & { readonly transport: 'none' }
  readonly FileSystemPort: PortRegistryEntry<FileSystemPort> & { readonly transport: 'none' }
  readonly AgentFileSystemPort: PortRegistryEntry<AgentFileSystemPort> & {
    readonly transport: 'none'
  }
  readonly FileCapabilitiesPort: PortRegistryEntry<FileCapabilitiesPort> & {
    readonly transport: 'none'
  }
  readonly WorkspacePort: PortRegistryEntry<WorkspacePort> & { readonly transport: 'none' }
  readonly WorkspaceFactsPort: PortRegistryEntry<WorkspaceFactsPort> & {
    readonly transport: 'none'
  }
  readonly WorkspaceIdentityPort: PortRegistryEntry<WorkspaceIdentityPort> & {
    readonly transport: 'none'
  }
  readonly QualityReviewPort: PortRegistryEntry<QualityReviewPort> & { readonly transport: 'none' }
  readonly DecisionPort: PortRegistryEntry<DecisionPort> & { readonly transport: 'none' }
  readonly JudgePort: PortRegistryEntry<JudgePort> & { readonly transport: 'none' }
  readonly NoticePort: PortRegistryEntry<NoticePort> & { readonly transport: 'none' }
  readonly ExecutionLocationSinkPort: PortRegistryEntry<ExecutionLocationSinkPort> & {
    readonly transport: 'none'
  }
}

export type RegisteredPortName = keyof PortRegistryEntries

/** The union of contracts the registry admits — the constraint on `registeredPortToken`. */
export type RegisteredPort = PortRegistryEntries[RegisteredPortName]['contract']

export type DetachedPortNames = {
  [K in RegisteredPortName]: PortRegistryEntries[K]['transport'] extends 'detached' ? K : never
}[RegisteredPortName]

export type RuntimeBinding = 'shared' | 'surface'

/**
 * The manifest a composition site passes to prove every registered port has its bindings.
 * Composing a session means naming, for every registry entry: where its runtime binding lives
 * ('shared' — the in-process impl local sessions and serve-in-sandbox share; 'surface' — the
 * composition site overrides it) and, for a detached port, the transport binding's remote
 * adapter contract. Adding a port to the registry adds a key here, so every composition site
 * lacking it stops compiling — that breakage is the contract. A 'none' transport carries `null`:
 * the empty slot is written down, never omitted.
 */
export type PortBindings = {
  readonly [K in RegisteredPortName]: {
    readonly runtime: RuntimeBinding
    readonly transport: PortRegistryEntries[K]['transport'] extends 'detached'
      ? PortContractShape<InstanceType<PortRegistryEntries[K]['contract']>>
      : null
  }
}

/**
 * What a composition site passes: every registered port's runtime binding, and for a detached
 * port either the remote adapter (a detached client) or `null` (an in-process session — serve,
 * a spec fake — declaring the empty slot). Requiring the key for every registered port is what
 * makes a new port break every composition site until it is bound.
 */
export type ComposedPortBindings = {
  readonly [K in RegisteredPortName]: {
    readonly runtime: RuntimeBinding
    readonly transport: PortRegistryEntries[K]['transport'] extends 'detached'
      ? PortContractShape<InstanceType<PortRegistryEntries[K]['contract']>> | null
      : null
  }
}
