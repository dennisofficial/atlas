import type { ThreadId } from '@dltech/atlas-core'
import type { PortableState } from '@dltech/atlas-wire'

import type { GitTokenReader } from './local-cloud-bootstrap'
import type { AttachOptions } from './local-cloud-attachment'
import type { PodDriverConfig } from './local-pod/driver'
import type { RunnerDriver } from './runner-driver'

export type PodBridgeDriver = RunnerDriver & {
  vaultPresent(args: { name: string }): Promise<boolean>
}

export type PodLeaseRegistrar = (args: { threadId: ThreadId; token: string }) => Promise<void>

export type LocalPodBridgeOptions = AttachOptions & {
  pod: () => PodDriverConfig
  attachmentToken: (args: { threadId: ThreadId }) => string
  registerPodLease: PodLeaseRegistrar
  readGitToken?: GitTokenReader | undefined
  capturePortable?: (() => Promise<PortableState>) | undefined
  environment?: (() => Record<string, string>) | undefined
  onDriverLog?: ((line: string) => void) | undefined
  driverWith?: ((config: PodDriverConfig) => PodBridgeDriver) | undefined
}
