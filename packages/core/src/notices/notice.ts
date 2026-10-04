export enum ENoticeTone {
  Done = 'done',
  Info = 'info',
  Warn = 'warn',
  Success = 'success',
}

export enum ENoticePosition {
  Tray = 'tray',
  Composer = 'composer',
}

export const NOTICE_MS = 4000

export const NOTICE_WARN_MS = 8000

export const NOTICE_MS_PER_CHAR = 50

export const NOTICE_READING_CAP_MS = 20000

export function readingFloorMs(args: { text: string }): number {
  return Math.min(args.text.length * NOTICE_MS_PER_CHAR, NOTICE_READING_CAP_MS)
}

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
