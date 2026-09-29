import { ENoticeTone } from '../../ui/notice-store'

export const CLOUD_MODEL_NOTICE_KEY = 'cloud-model-change-failed'

export const CLOUD_RENAME_NOTICE_KEY = 'cloud-rename-failed'

export const cloudModelFailureNotice = (): {
  key: string
  tone: ENoticeTone
  text: string
} => ({
  key: CLOUD_MODEL_NOTICE_KEY,
  tone: ENoticeTone.Warn,
  text: "the model change didn't reach the cloud session — the footer is back on what the sandbox is running",
})

export const cloudRenameFailureNotice = (): {
  key: string
  tone: ENoticeTone
  text: string
} => ({
  key: CLOUD_RENAME_NOTICE_KEY,
  tone: ENoticeTone.Warn,
  text: "the rename didn't reach the cloud session — its title is unchanged",
})
