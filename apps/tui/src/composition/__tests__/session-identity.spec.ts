import { describe, expect, it } from 'bun:test'

import { EOpenMode } from '../config'
import { launchLine, launchTitle, sessionIdentityLine } from '../session-identity'

const HOME = '/Users/operator'

const AT = new Date(2026, 8, 16, 18, 52, 31)

describe('launchLine', () => {
  it('names the conversation a resume was pointed at', () => {
    const line = launchLine({
      open: { mode: EOpenMode.Resume, threadId: 'wash-the-settings-footer' },
      directory: `${HOME}/Developer/atlas`,
      home: HOME,
      pid: 41233,
      at: AT,
    })

    expect(line).toBe(
      'atlas · 18:52:31 · pid 41233 · ~/Developer/atlas · resume "wash-the-settings-footer"\n',
    )
  })

  it('says nothing about opening when the launch is new', () => {
    const line = launchLine({
      open: { mode: EOpenMode.New },
      directory: `${HOME}/Developer/atlas`,
      home: HOME,
      pid: 7,
      at: AT,
    })

    expect(line).toBe('atlas · 18:52:31 · pid 7 · ~/Developer/atlas\n')
  })
})

describe('launchTitle', () => {
  it('keeps the handle a restart was handed', () => {
    expect(launchTitle({ mode: EOpenMode.Resume, threadId: 'rescue-the-crash' })).toBe(
      'rescue-the-crash',
    )
  })

  it('leaves a fresh launch to the directory', () => {
    expect(launchTitle({ mode: EOpenMode.New })).toBeNull()
  })
})

describe('sessionIdentityLine', () => {
  it('reads as the handle the operator would resume with', () => {
    const line = sessionIdentityLine({
      active: { threadId: 'brn_1', title: 'Wash the settings footer', started: true },
      directory: `${HOME}/Developer/atlas`,
      home: HOME,
      pid: 41233,
    })

    expect(line).toBe('wash-the-settings-footer · ~/Developer/atlas · pid 41233')
  })

  it('still places the tile when nothing has been opened', () => {
    const line = sessionIdentityLine({
      active: null,
      directory: `${HOME}/Developer/atlas`,
      home: HOME,
      pid: 41233,
    })

    expect(line).toBe('no conversation yet · ~/Developer/atlas · pid 41233')
  })
})
