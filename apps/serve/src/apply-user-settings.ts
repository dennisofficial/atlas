import { parseSettingsDocument, type JsonValue } from '@dltech/atlas-core'
import type { SettingsService } from '@dltech/atlas-harness'

import { EServeEvent, type ServeLog } from './serve-log'

export type UserSettingsTarget = Pick<SettingsService, 'applyUserDocument'>

const isDocumentObject = (raw: JsonValue): boolean =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

export function createUserSettingsApplier(args: {
  settings: UserSettingsTarget
  log: ServeLog
}): (content: string) => void {
  const { settings, log } = args

  return (content) => {
    let raw: JsonValue
    try {
      raw = JSON.parse(content) as JsonValue
    } catch {
      log({ event: EServeEvent.SettingsDropped, reason: 'the content was not JSON' })
      return
    }

    if (!isDocumentObject(raw)) {
      log({ event: EServeEvent.SettingsDropped, reason: 'the content was not a settings object' })
      return
    }

    const written = settings.applyUserDocument(parseSettingsDocument(raw))
    if (written.ok) return
    log({ event: EServeEvent.SettingsDropped, reason: written.message })
  }
}
