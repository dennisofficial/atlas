import { NoticePort, type NoticePost } from '@dltech/atlas-core'

export enum EServeEvent {
  Listening = 'serve.listening',
  Started = 'serve.started',
  Stopped = 'serve.stopped',
  Notice = 'serve.notice',
  Resumable = 'serve.resumable',
  ClientAttached = 'serve.client-attached',
  ClientRefused = 'serve.client-refused',
  ClientDetached = 'serve.client-detached',
  ClientsParked = 'serve.clients-parked',
  TurnStarted = 'serve.turn-started',
  TurnEnded = 'serve.turn-ended',
  TurnFailed = 'serve.turn-failed',
  IdleStop = 'serve.idle-stop',
  InterruptRequested = 'serve.interrupt-requested',
  ShutdownRequested = 'serve.shutdown-requested',
  ParkRefused = 'serve.park-refused',
  ParkFinalized = 'serve.park-finalized',
  ParkUnfinalized = 'serve.park-unfinalized',
  ParkStopFailed = 'serve.park-stop-failed',
  DrainRequested = 'serve.drain-requested',
  DrainSealed = 'serve.drain-sealed',
  DrainStepFailed = 'serve.drain-step-failed',
  CheckpointUnpublishable = 'serve.checkpoint-unpublishable',
  CheckpointPersistFailed = 'serve.checkpoint-persist-failed',
  CheckpointMirrorFailed = 'serve.checkpoint-mirror-failed',
  IdleCheckFailed = 'serve.idle-check-failed',
  WorkspaceReady = 'serve.workspace-ready',
  WorkspaceFailed = 'serve.workspace-failed',
  ProfileStepFailed = 'serve.profile-step-failed',
  ContextReady = 'serve.context-ready',
  ContextFailed = 'serve.context-failed',
  TranscriptRestored = 'serve.transcript-restored',
  TranscriptFailed = 'serve.transcript-failed',
  ChildrenAdopted = 'serve.children-adopted',
  ChildAdoptionFailed = 'serve.child-adoption-failed',
  LostShellsSettled = 'serve.lost-shells-settled',
  LostShellSettlementFailed = 'serve.lost-shell-settlement-failed',
  LostAgentsSettled = 'serve.lost-agents-settled',
  LostAgentSettlementFailed = 'serve.lost-agent-settlement-failed',
  PortableStateInstalled = 'serve.portable-state-installed',
  PortableStateFailed = 'serve.portable-state-failed',
  SettingsDropped = 'serve.settings-dropped',
  RotationFailed = 'serve.rotation-failed',
}

export type ServeLogLine = { event: EServeEvent; [field: string]: unknown }

export type ServeLog = (line: ServeLogLine) => void

export type LogWrite = (line: string) => void

export const stdoutLine: LogWrite = (line) => {
  process.stdout.write(`${line}\n`)
}

export const createServeLog = (args: { write?: LogWrite | undefined }): ServeLog => {
  const write = args.write ?? stdoutLine
  return ({ event, ...rest }) =>
    write(JSON.stringify({ at: new Date().toISOString(), event, ...rest }))
}

export class LoggingNoticePort extends NoticePort {
  private readonly log: ServeLog

  constructor(args: { log: ServeLog }) {
    super()
    this.log = args.log
  }

  notify(post: NoticePost): void {
    this.log({
      event: EServeEvent.Notice,
      tone: post.tone,
      key: post.key ?? null,
      text: post.text,
    })
  }
}
