import type { Binding } from './session-binding'
import type { OpenedConversation } from './open-conversation'

export type ReloadedSession = {
  binding: Binding
  opened: OpenedConversation
  reloads: number
}
