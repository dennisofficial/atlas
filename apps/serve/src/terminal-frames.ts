import { EServeFrame, type ServeFrame, type TerminalEvent } from '@dltech/atlas-harness'

export const terminalFrameOf = (event: TerminalEvent): ServeFrame =>
  event.type === 'output'
    ? { kind: EServeFrame.TerminalOutput, terminalId: event.terminalId, data: event.data }
    : {
        kind: EServeFrame.TerminalExit,
        terminalId: event.terminalId,
        exitCode: event.exitCode,
        signal: event.signal,
      }
