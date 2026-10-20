import type { ThreadId } from '@dltech/atlas-core'
import type { PortableState, RuntimeCheckpoint, VercelSandboxConfig } from '@dltech/atlas-wire'

import type { SettingsService } from '../settings/service'
import type { MirrorLocalLog } from './transcript-syncer'
import type {
  BridgeDriver,
  PortableOmissions,
  RegistrationSender,
  SandboxRegistration,
} from './local-cloud-bootstrap'

export type SandboxAuthorizer = (args: {
  threadId: ThreadId
  token: string
  serveUrl: string
  model?: string | undefined
}) => Promise<void>

export type LocalCloudBridgeOptions = {
  vercel: () => VercelSandboxConfig
  attachmentToken: (args: { threadId: ThreadId }) => string
  /**
   * Runs only when the sandbox needs a snapshot — a fresh boot, or a resume whose vault never
   * materialised after a failed first boot. A healthy resume never captures, so the sandbox's
   * newer vault is never overwritten.
   */
  capturePortable?: (() => Promise<PortableState>) | undefined
  authorizeSandbox?: SandboxAuthorizer | undefined
  registration?: SandboxRegistration | undefined
  sendRegistration?: RegistrationSender | undefined
  onRegistrationFailed?: ((failure: unknown) => void) | undefined
  /**
   * A background mirror sync failed — the wire died mid-read, or the writer's disk refused it.
   * Best-effort by design: the next signal retries, so this is a heads-up, never a thrown error.
   */
  onMirrorFailed?: ((failure: unknown) => void) | undefined
  /**
   * A previously reported mirror failure has healed — a sync landed after one threw. Only fires
   * after an onMirrorFailed, never on steady-state syncs, so the surface clears its warning rather
   * than churning it.
   */
  onMirrorRecovered?: (() => void) | undefined
  onPortableOmitted?: ((omitted: PortableOmissions) => void) | undefined
  environment?: (() => Record<string, string>) | undefined
  cloudUrl?: (() => string) | undefined
  readCheckpoint?: ((args: { threadId: ThreadId }) => Promise<RuntimeCheckpoint | null>) | undefined
  onDriverLog?: ((line: string) => void) | undefined
  /**
   * The newest durable event seq the client holds for a thread, reported on the Hello so the serve
   * can vouch the log is current. The truthful source is the local event store, so a Promise is
   * honoured. Absent means the client can never be vouched current.
   */
  lastEventSeq?: ((args: { threadId: ThreadId }) => number | Promise<number>) | undefined
  /**
   * The client's local transcript log the mirror serves reads from while the session runs in the cloud. Absent, the
   * attach falls back to the channel-only RemoteEventLog, so a caller that never kept a local
   * transcript (the live roundtrip script) still gets working reads.
   */
  localLog?: MirrorLocalLog | undefined
  /**
   * Attaching streams the cloud session directory (thread metas, context/, ledger, logs —
   * everything but the event log, which the transcript mirror owns) into the local session dir,
   * current by construction while the channel is open. Set false to opt out (specs, one-shot
   * probes that never render).
   */
  sessionMirror?: boolean | undefined
  driverWith?: ((config: VercelSandboxConfig) => BridgeDriver) | undefined
  settings?: SettingsService | undefined
  projectIdOf?: ((args: { threadId: ThreadId }) => Promise<string | null>) | undefined
}
