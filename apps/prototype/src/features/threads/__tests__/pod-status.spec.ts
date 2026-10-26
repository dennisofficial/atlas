import { describe, expect, it } from 'bun:test'

import { EPodPhase, terminalConnectionOf } from '../pod-state'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

describe('terminalConnectionOf', () => {
  it('connects while starting, connects when ready and disconnects on failure', () => {
    expect(terminalConnectionOf(EPodPhase.Starting)).toBe(ETerminalConnection.Connecting)
    expect(terminalConnectionOf(EPodPhase.Ready)).toBe(ETerminalConnection.Connected)
    expect(terminalConnectionOf(EPodPhase.Failed)).toBe(ETerminalConnection.Disconnected)
    expect(terminalConnectionOf(EPodPhase.None)).toBeUndefined()
  })
})
