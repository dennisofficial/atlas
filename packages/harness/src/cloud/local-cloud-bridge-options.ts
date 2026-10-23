import type { ThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint, VercelSandboxConfig } from '@dltech/atlas-wire'

import type { SettingsService } from '../settings/service'
import type { BridgeDriver, RegistrationSender, SandboxRegistration } from './local-cloud-bootstrap'

export type SandboxAuthorizer = (args: {
  threadId: ThreadId
  token: string
  serveUrl: string
  model?: string | undefined
}) => Promise<void>

export type LocalCloudBridgeOptions = {
  vercel: () => VercelSandboxConfig
  attachmentToken: (args: { threadId: ThreadId }) => string
  authorizeSandbox?: SandboxAuthorizer | undefined
  registration?: SandboxRegistration | undefined
  sendRegistration?: RegistrationSender | undefined
  onRegistrationFailed?: ((failure: unknown) => void) | undefined
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
  driverWith?: ((config: VercelSandboxConfig) => BridgeDriver) | undefined
  settings?: SettingsService | undefined
  projectIdOf?: ((args: { threadId: ThreadId }) => Promise<string | null>) | undefined
}
