import type {
  PodConnectReply,
  PodResizeReply,
  PodStatus,
  ReadRuntimeCheckpointReply,
  SandboxProvisionReply,
  ThreadStreamFrame,
} from '@dltech/atlas-wire'

export type PodStreamHandlers = {
  onStarted?: () => void
  onData?: (frame: ThreadStreamFrame) => void
  onError?: (failure: unknown) => void
  onComplete?: () => void
  onStopped?: () => void
  onConnectionStateChange?: (state: { state: string; error: unknown }) => void
}

type ThreadInput = { threadId: string }

export type CreatePodThreadInput = {
  id: string
  projectId?: string
  model?: string
  effort?: string
}

export type PodApiClient = {
  threads: {
    create: { mutate(input: CreatePodThreadInput): Promise<unknown> }
  }
  threadSandbox: {
    provision: { mutate(input: ThreadInput): Promise<SandboxProvisionReply> }
  }
  threadPod: {
    status: { query(input: ThreadInput): Promise<PodStatus> }
    connect: { mutate(input: ThreadInput): Promise<PodConnectReply> }
    resize: {
      mutate(input: ThreadInput & { vcpus: number }): Promise<PodResizeReply>
    }
    destroy: { mutate(input: ThreadInput): Promise<void> }
  }
  sandboxCheckpoint: {
    get: { query(input: ThreadInput): Promise<ReadRuntimeCheckpointReply> }
  }
  threadEvents: {
    stream: {
      subscribe(input: ThreadInput, handlers: PodStreamHandlers): { unsubscribe(): void }
    }
  }
}
