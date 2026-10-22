import { EAuthor, EEntryKind, type SandboxNoticeEntry } from './transcript-model'

export enum ESandboxNoticeState {
  Starting = 'starting',
  Running = 'running',
  Stopped = 'stopped',
  Failed = 'failed',
}

export type TranscriptSandbox = {
  state: ESandboxNoticeState
  label: string
  reason?: string | undefined
}

const SANDBOX_NOTICE_KEY = 'sandbox-notice'

export function sandboxNoticeOf(sandbox: TranscriptSandbox | null): SandboxNoticeEntry[] {
  if (sandbox === null) return []

  const shared = {
    kind: EEntryKind.SandboxNotice,
    author: EAuthor.Model,
    key: SANDBOX_NOTICE_KEY,
  } as const

  if (sandbox.state === ESandboxNoticeState.Starting) {
    return [
      {
        ...shared,
        text: `starting the container — ${sandbox.label} can take minutes to pull the first time`,
        failed: false,
      },
    ]
  }
  if (sandbox.state === ESandboxNoticeState.Failed) {
    return [
      {
        ...shared,
        text: `the container failed to start: ${sandbox.reason ?? 'the daemon gave no reason'}`,
        failed: true,
      },
    ]
  }
  return []
}
