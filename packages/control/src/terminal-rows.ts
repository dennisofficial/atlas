export type TerminalState = 'opening' | 'open' | 'ended'

export type TerminalEndedReason = 'exited' | 'closed' | 'pod-slept' | 'lost' | 'failed'

export type ControlTerminalRow = {
  sessionId: string
  terminalId: string
  ordinal: number
  name: string
  state: TerminalState
  exitCode: number | null
  signal: string | null
  endedReason: TerminalEndedReason | null
  createdAt: string
  endedAt: string | null
}

export type EndTerminalParams = {
  sessionId: string
  terminalId: string
  reason: TerminalEndedReason
  exitCode?: number | null | undefined
  signal?: string | null | undefined
}

export type CreateTerminalParams = {
  sessionId: string
  terminalId: string
  limit: number
}
