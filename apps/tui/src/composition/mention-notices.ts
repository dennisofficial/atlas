import { clearNotice, ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'

export const reportMentionProblem = (reason: string): void => {
  notify({ text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, key: 'mention-files' })
}

export const beginMentionPreparation = (): void => {
  notify({
    text: 'Reading mentioned files…',
    tone: ENoticeTone.Info,
    key: 'mention-preparing',
    sticky: true,
  })
}

export const finishMentionPreparation = (): void => {
  clearNotice({ key: 'mention-preparing' })
}
