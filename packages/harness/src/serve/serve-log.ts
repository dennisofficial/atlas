import { NoticePort, type NoticePost } from '@dltech/atlas-core'

export enum EServeEvent {
  Started = 'serve.started',
  Stopped = 'serve.stopped',
  Notice = 'serve.notice',
  Resumable = 'serve.resumable',
  ClientAttached = 'serve.client-attached',
  ClientRefused = 'serve.client-refused',
  ClientDetached = 'serve.client-detached',
  TurnStarted = 'serve.turn-started',
  TurnEnded = 'serve.turn-ended',
  TurnFailed = 'serve.turn-failed',
  HeartbeatFailed = 'serve.heartbeat-failed',
  WorkspaceReady = 'serve.workspace-ready',
  WorkspaceFailed = 'serve.workspace-failed',
  ChildrenAdopted = 'serve.children-adopted',
  ChildAdoptionFailed = 'serve.child-adoption-failed',
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
