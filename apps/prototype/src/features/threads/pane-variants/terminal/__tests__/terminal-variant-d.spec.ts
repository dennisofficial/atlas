import { describe, expect, test } from 'bun:test'

import { breadcrumbSegments } from '../terminal-variant-d-chrome'
import { ETerminalEnd, ETerminalStatus, type PaneTerminal } from '../terminal-scenario'
import { shellState } from '../terminal-variant-d-strip'

function terminalOf(status: ETerminalStatus, exitCode: number | null): PaneTerminal {
  return {
    id: 'term-1',
    label: 'Terminal 1',
    cwd: '~/workspace/apps/web',
    entries: [],
    status,
    lastCommand: 'bun run dev',
    exitCode,
    endedBy: exitCode === null ? null : ETerminalEnd.Exited,
  }
}

describe('breadcrumbSegments', () => {
  test('splits a home-relative cwd into breadcrumb segments', () => {
    expect(breadcrumbSegments('~/workspace/apps/web')).toEqual(['~', 'workspace', 'apps', 'web'])
  })

  test('drops empty segments', () => {
    expect(breadcrumbSegments('/')).toEqual([])
  })
})

describe('shellState', () => {
  test('reports a live shell as running', () => {
    expect(shellState(terminalOf(ETerminalStatus.Live, null))).toBe('running')
  })

  test('reports the exit code of an ended shell', () => {
    expect(shellState(terminalOf(ETerminalStatus.Ended, 3))).toBe('exit 3')
  })

  test('reports a shell that ended without a code as ended', () => {
    expect(shellState(terminalOf(ETerminalStatus.Ended, null))).toBe('ended')
  })

  test('reports a disconnected shell', () => {
    expect(shellState(terminalOf(ETerminalStatus.Disconnected, null))).toBe('disconnected')
  })
})
