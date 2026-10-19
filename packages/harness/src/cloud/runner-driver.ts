import type { SandboxStateWire, SettleWaitNotice } from '@dltech/atlas-wire'

export type RunnerPodHandle = { name: string }

export type PodObservation = {
  state: SandboxStateWire
  url?: string | undefined
  sandboxSessionId?: string | undefined
}

export type PodPlacement = {
  url: string
  state: SandboxStateWire
  created: boolean
  token: string
  rotatedFrom?: string | undefined
  rotatedProtocol?: number | undefined
  serveVersion?: string | undefined
}

export type PodProvisionArgs<THandle> = {
  name: string
  threadId: string
  token?: string | undefined
  pinnedModel?: string | undefined
  putContextOnFreshBoot?: ((handle: THandle) => Promise<void>) | undefined
  environment?: Record<string, string> | undefined
  onRotationStarted?: (() => void) | undefined
  onSettleWait?: ((notice: SettleWaitNotice) => void) | undefined
}

export type RunnerDriver<THandle = RunnerPodHandle> = {
  createOrResume(args: PodProvisionArgs<THandle>): Promise<PodPlacement>
  inspect(args: { name: string }): Promise<PodObservation | undefined>
  writeBootstrapFile(args: { name: string; path: string; content: Uint8Array | string }): Promise<void>
  readResources(args: { name: string }): Promise<{ vcpus?: number; memoryMb?: number }>
  updateResources(args: { name: string; vcpus: number }): Promise<void>
  destroy(args: { name: string; sessionId?: string | undefined }): Promise<void>
}
