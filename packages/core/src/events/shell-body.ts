import type { EKilledBy, EShellStatus } from '../shells/status'

export type BackgroundShellEventBody =
  | {
      type: 'background-shell-started'
      shellId: string
      command: string
      description?: string | undefined
      bootId?: string | undefined
      outputPath?: string | undefined
    }
  | {
      type: 'background-shell-ended'
      shellId: string
      command: string
      description?: string | undefined
      bootId?: string | undefined
      status: EShellStatus
      killedBy?: EKilledBy | undefined
      exitCode?: number | undefined
      output: string
      droppedCharacters: number
      remainingCharacters: number
      outputPath?: string | undefined
      outputStart?: number | undefined
      outputEnd?: number | undefined
    }
  | {
      type: 'background-shell-awaiting-input'
      shellId: string
      command: string
      description?: string | undefined
      bootId?: string | undefined
      output: string
      droppedCharacters: number
      remainingCharacters: number
      inputSupported?: boolean | undefined
      outputPath?: string | undefined
      outputStart?: number | undefined
      outputEnd?: number | undefined
    }
  | {
      type: 'background-shell-matched'
      shellId: string
      command: string
      description?: string | undefined
      bootId?: string | undefined
      pattern: string
      lines: string
      matchCount: number
      watchDisarmed?: boolean | undefined
      outputPath?: string | undefined
      outputStart?: number | undefined
      outputEnd?: number | undefined
    }
  | {
      type: 'background-shell-still-running'
      shellId: string
      command: string
      description?: string | undefined
      runningForMs: number
      silentForMs: number
      checkInMs: number
      tail: string
    }
