import type { KeyEvent } from '@opentui/core'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import type { SessionClient } from './session-client'

export type ChatScreenHostProps = {
  client: SessionClient
  sessionId: string
  title: string | null
  width: number
  height: number
  now: () => number
  cwd: string
  onBack: () => void
  onNew: () => void
  onModel: () => void
  onQuit: () => void
  onKeys: (handler: (key: KeyEvent) => boolean) => void
  choosingModel: boolean
  clientVersion: string
  teammates: readonly StreamSessionRow[]
  row: StreamSessionRow | undefined
  openUrl: (url: string) => void
  onOpenSession: (agentId: string) => void
  onSettings: () => void
  onAuth: () => void
}
