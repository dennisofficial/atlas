import type { ComposedPortBindings } from '@dltech/atlas-core'

import { RemoteAccountStore } from '../cloud/remote-account-store'
import { RemoteEventLog } from '../cloud/remote-event-log'
import { RemoteThreadStore } from '../cloud/remote-thread-store'
import { RemoteTurnLedger } from '../cloud/remote-turn-ledger'

/**
 * The bindings every session shares, surface or not: the harness's in-process runtime impls
 * ('shared'), and for the detached store ports the transport adapters the wire carries. A
 * composition site spreads this and overrides only the keys its surface genuinely re-binds.
 */
export const sharedPortBindings = {
  ClockPort: { runtime: 'shared', transport: null },
  IdPort: { runtime: 'shared', transport: null },
  TelemetryPort: { runtime: 'shared', transport: null },
  EventLogPort: { runtime: 'shared', transport: RemoteEventLog },
  LogPort: { runtime: 'shared', transport: null },
  ModelPort: { runtime: 'shared', transport: null },
  CredentialPort: { runtime: 'shared', transport: null },
  AccountStorePort: { runtime: 'shared', transport: RemoteAccountStore },
  ProcessPort: { runtime: 'shared', transport: null },
  FileSystemPort: { runtime: 'shared', transport: null },
  AgentFileSystemPort: { runtime: 'shared', transport: null },
  FileCapabilitiesPort: { runtime: 'shared', transport: null },
  WorkspacePort: { runtime: 'shared', transport: null },
  WorkspaceFactsPort: { runtime: 'shared', transport: null },
  WorkspaceIdentityPort: { runtime: 'shared', transport: null },
  QualityReviewPort: { runtime: 'shared', transport: null },
  DecisionPort: { runtime: 'shared', transport: null },
  JudgePort: { runtime: 'shared', transport: null },
  NoticePort: { runtime: 'surface', transport: null },
  ExecutionLocationSinkPort: { runtime: 'shared', transport: null },
  ThreadStorePort: { runtime: 'shared', transport: RemoteThreadStore },
  TurnLedgerPort: { runtime: 'shared', transport: RemoteTurnLedger },
  SessionAuthorityPort: { runtime: 'shared', transport: null },
  FileReadStatePort: { runtime: 'shared', transport: null },
  FileWriteGuardPort: { runtime: 'shared', transport: null },
  ShellLauncherPort: { runtime: 'shared', transport: null },
  OperatorInputPort: { runtime: 'shared', transport: null },
  SkillRegistryPort: { runtime: 'shared', transport: null },
  ToolRegistry: { runtime: 'shared', transport: null },
  ToolDispatcher: { runtime: 'shared', transport: null },
  PromptRegistry: { runtime: 'shared', transport: null },
  GithubUiBridgePort: { runtime: 'shared', transport: null },
  PullRequestPort: { runtime: 'shared', transport: null },
  PrEventFrameSink: { runtime: 'shared', transport: null },
  AppInstallRecommendationSink: { runtime: 'shared', transport: null },
  UserLayerSyncPort: { runtime: 'shared', transport: null },
  MemoryPort: { runtime: 'shared', transport: null },
  GitChangesPort: { runtime: 'shared', transport: null },
  TerminalPort: { runtime: 'shared', transport: null },
} satisfies Partial<ComposedPortBindings>

/**
 * The manifest for a composition with no detached client of its own — serve-in-sandbox and the
 * spec fakes. The cloud-registry ports declare their empty transport slot: their remote adapters
 * belong to the detached client (the TUI), not to the process running the session. Typed as the
 * base bindings plus the empty detached slots rather than the full detached manifest — a process
 * with no detached client never names a remote adapter.
 */
export const inProcessPortBindings = {
  ...sharedPortBindings,
  RotationPort: { runtime: 'shared', transport: null },
  ShellRegistryPort: { runtime: 'shared', transport: null },
  AgentRegistryPort: { runtime: 'shared', transport: null },
  ServiceRegistryPort: { runtime: 'shared', transport: null },
  SubscriptionRegistryPort: { runtime: 'shared', transport: null },
} satisfies Partial<ComposedPortBindings>
