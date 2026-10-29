import type { ThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { AttachOptions } from './local-cloud-attachment'
import type { PodDriverConfig } from './local-pod/driver'
import type { RunnerDriver } from './runner-driver'

export type PodBridgeDriver = RunnerDriver

export type PodLeaseRegistrar = (args: { threadId: ThreadId; token: string }) => Promise<void>

export type LocalPodThreadRegistrar = (args: {
  threadId: ThreadId
  projectId: string | null
  model?: string | undefined
  effort?: string | undefined
}) => Promise<void>

export type LocalPodBridgeOptions = AttachOptions & {
  pod: () => PodDriverConfig
  attachmentToken: (args: { threadId: ThreadId }) => string
  registerPodLease: PodLeaseRegistrar
  registerThread?: LocalPodThreadRegistrar | undefined
  readPodCheckpoint?:
    | ((args: { threadId: ThreadId }) => Promise<RuntimeCheckpoint | null>)
    | undefined
  environment?: (() => Record<string, string>) | undefined
  onDriverLog?: ((line: string) => void) | undefined
  driverWith?: ((config: PodDriverConfig) => PodBridgeDriver) | undefined
}
