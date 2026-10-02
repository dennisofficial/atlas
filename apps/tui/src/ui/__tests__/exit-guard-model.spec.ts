import { toThreadId } from '@dltech/atlas-core'
import { toShellId } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import {
  AGENT_TAG,
  EExitChoice,
  EXIT_GUARD_OPTIONS,
  exitGuardAgentRow,
  exitGuardRow,
  moveSelection,
  openExitGuard,
  resolve,
  selectedOption,
  SHELL_TAG,
} from '../exit-guard-model'

const OPTIONS = EXIT_GUARD_OPTIONS

const opened = () => openExitGuard()

const at = (choice: EExitChoice): number =>
  OPTIONS.findIndex((option) => option.choice === choice)

describe('exit guard options', () => {
  it('offers stopping and staying', () => {
    expect(OPTIONS.map((option) => option.choice)).toEqual([
      EExitChoice.StopAndExit,
      EExitChoice.Stay,
    ])
  })

  it('enables every option it offers', () => {
    expect(OPTIONS.every((option) => option.enabled)).toBe(true)
  })
})

describe('opening the exit guard', () => {
  it('selects the first option', () => {
    expect(resolve({ state: opened() })).toBe(EExitChoice.StopAndExit)
  })

  it('carries nothing but the selection', () => {
    expect(opened()).toEqual({ selected: at(EExitChoice.StopAndExit) })
  })
})

describe('moving the selection', () => {
  it('steps down to the next option', () => {
    const moved = moveSelection({ state: opened(), delta: 1 })

    expect(moved.selected).toBe(at(EExitChoice.Stay))
  })

  it('steps back up', () => {
    const bottom = moveSelection({ state: opened(), delta: 1 })
    const moved = moveSelection({ state: bottom, delta: -1 })

    expect(moved.selected).toBe(at(EExitChoice.StopAndExit))
  })

  it('clamps at the bottom rather than wrapping', () => {
    const bottom = moveSelection({ state: opened(), delta: 1 })
    const past = moveSelection({ state: bottom, delta: 1 })

    expect(past.selected).toBe(at(EExitChoice.Stay))
  })

  it('clamps at the top rather than wrapping', () => {
    const past = moveSelection({ state: opened(), delta: -1 })

    expect(past.selected).toBe(at(EExitChoice.StopAndExit))
  })

  it('stands still on a zero delta', () => {
    const state = opened()

    expect(moveSelection({ state, delta: 0 })).toBe(state)
  })
})

describe('resolving a choice', () => {
  it('returns the option the selection sits on', () => {
    const moved = moveSelection({ state: opened(), delta: 1 })

    expect(resolve({ state: moved })).toBe(EExitChoice.Stay)
  })

  it('returns nothing when the selection sits off the end', () => {
    expect(resolve({ state: { selected: OPTIONS.length } })).toBeNull()
  })

  it('reports the selected option itself', () => {
    expect(selectedOption({ state: opened() })?.choice).toBe(EExitChoice.StopAndExit)
    expect(selectedOption({ state: { selected: -1 } })).toBeUndefined()
  })
})

describe('rows for live background work', () => {
  it('labels a shell with its description', () => {
    const row = exitGuardRow({
      shellId: toShellId('bash_1'),
      command: 'bun run dev',
      description: 'dev server',
    })

    expect(row).toEqual({ id: 'bash_1', tag: SHELL_TAG, label: 'dev server' })
  })

  it('falls back to the command when there is no description', () => {
    const row = exitGuardRow({ shellId: toShellId('bash_2'), command: 'bun run dev' })

    expect(row.label).toBe('bun run dev')
  })

  it('falls back to the command when the description is only whitespace', () => {
    const row = exitGuardRow({
      shellId: toShellId('bash_3'),
      command: 'bun  test\n--watch',
      description: '  ',
    })

    expect(row.label).toBe('bun test --watch')
  })
})

describe('rows for live sub-agents', () => {
  it('names a child by what it was asked to do', () => {
    const row = exitGuardAgentRow({
      agentId: toThreadId('thr_child'),
      agentType: 'explore',
      intent: 'auditing the credential vault',
    })

    expect(row).toEqual({
      id: 'thr_child',
      tag: AGENT_TAG,
      label: 'auditing the credential',
    })
  })

  it('falls back to the agent type when the child was spawned without an intent', () => {
    const row = exitGuardAgentRow({
      agentId: toThreadId('thr_child'),
      agentType: 'explore',
      intent: '   ',
    })

    expect(row.label).toBe('explore')
  })

  it('tells a child apart from a shell so the guard can say which is which', () => {
    const shell = exitGuardRow({ shellId: toShellId('bash_1'), command: 'bun run dev' })
    const child = exitGuardAgentRow({
      agentId: toThreadId('thr_child'),
      agentType: 'explore',
      intent: 'looking',
    })

    expect(shell.tag).toBe(SHELL_TAG)
    expect(child.tag).toBe(AGENT_TAG)
    expect(shell.tag).not.toBe(child.tag)
  })
})
