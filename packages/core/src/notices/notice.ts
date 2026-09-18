export enum ENoticeTone {
  Done = 'done',
  Info = 'info',
  Warn = 'warn',
}

export enum ENoticePosition {
  Tray = 'tray',
  Composer = 'composer',
}

export const NOTICE_MS = 2000

export const NOTICE_WARN_MS = 6000

export type Notice = {
  readonly key: string
  readonly text: string
  readonly tone: ENoticeTone
  readonly position: ENoticePosition
  readonly issuedAtMs: number
  readonly ttlMs: number | null
}

export type NoticeDraft = {
  readonly key: string
  readonly text: string
  readonly tone: ENoticeTone
  readonly position?: ENoticePosition
  readonly ttlMs: number | null
}
