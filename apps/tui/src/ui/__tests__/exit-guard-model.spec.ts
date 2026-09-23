import { toThreadId } from '@dltech/atlas-core'
import { toShellId } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import {
  AGENT_TAG,
  DETACH_NOTE,
  EExitChoice,
  exitGuardAgentRow,
  exitGuardOptions,
  exitGuardRow,
  moveSelection,
  openExitGuard,
  resolve,
  selectedOption,
  SHELL_TAG,
} from '../exit-guard-model'

const LOCAL = exitGuardOptions({ cloud: false })

const CLOUD = exitGuardOptions({ cloud: true })

const openedLocal = () => openExitGuard({ options: LOCAL })

const at = (choice: EExitChoice): number =>
  LOCAL.findIndex((option) => option.choice === choice)

describe('exit guard options', () => {
  it('offers stopping and staying to a local conversation, hiding detach', () => {
    expect(LOCAL.map((option) => option.choice)).toEqual([
      EExitChoice.StopAndExit,
      EExitChoice.Stay,
    ])
  })

  it('offers detaching first to a cloud conversation, and never stopping', () => {
    expect(CLOUD.map((option) => option.choice)).toEqual([EExitChoice.Detach, EExitChoice.Stay])
  })

  it('enables detaching and says what survives it', () => {
    const detach = CLOUD[0]

    expect(detach?.enabled).toBe(true)
    expect(detach?.note).toBe(DETACH_NOTE)
    expect(detach?.note).toContain('turn keeps running')
    expect(detach?.note).toContain('filesystem persists via snapshot')
    expect(detach?.note).toContain('services die on park')
  })

  it('enables every option it offers', () => {
    for (const options of [LOCAL, CLOUD]) {
      expect(options.every((option) => option.enabled)).toBe(true)
    }
  })
})

describe('opening the exit guard', () => {
  it('selects the first option', () => {
    expect(resolve({ options: LOCAL, state: openedLocal() })).toBe(EExitChoice.StopAndExit)
  })

  it('selects detach first for a cloud conversation', () => {
    expect(resolve({ options: CLOUD, state: openExitGuard({ options: CLOUD }) })).toBe(
      EExitChoice.Detach,
    )
  })

  it('carries nothing but the selection', () => {
    expect(openedLocal()).toEqual({ selected: at(EExitChoice.StopAndExit) })
  })
})

describe('moving the selection', () => {
  it('steps down to the next option', () => {
    const moved = moveSelection({ options: LOCAL, state: openedLocal(), delta: 1 })

    expect(moved.selected).toBe(at(EExitChoice.Stay))
  })

  it('steps back up', () => {
    const bottom = moveSelection({ options: LOCAL, state: openedLocal(), delta: 1 })
    const moved = moveSelection({ options: LOCAL, state: bottom, delta: -1 })

    expect(moved.selected).toBe(at(EExitChoice.StopAndExit))
  })

  it('clamps at the bottom rather than wrapping', () => {
    const bottom = moveSelection({ options: LOCAL, state: openedLocal(), delta: 1 })
    const past = moveSelection({ options: LOCAL, state: bottom, delta: 1 })

    expect(past.selected).toBe(at(EExitChoice.Stay))
  })

  it('clamps at the top rather than wrapping', () => {
    const past = moveSelection({ options: LOCAL, state: openedLocal(), delta: -1 })

    expect(past.selected).toBe(at(EExitChoice.StopAndExit))
  })

  it('stands still on a zero delta', () => {
    const state = openedLocal()

    expect(moveSelection({ options: LOCAL, state, delta: 0 })).toBe(state)
  })
})

describe('resolving a choice', () => {
  it('returns the option the selection sits on', () => {
    const moved = moveSelection({ options: LOCAL, state: openedLocal(), delta: 1 })

    expect(resolve({ options: LOCAL, state: moved })).toBe(EExitChoice.Stay)
  })

  it('returns nothing when the selection sits off the end', () => {
    expect(resolve({ options: LOCAL, state: { selected: LOCAL.length } })).toBeNull()
  })

  it('reports the selected option itself', () => {
    expect(selectedOption({ options: LOCAL, state: openedLocal() })?.choice).toBe(
      EExitChoice.StopAndExit,
    )
    expect(selectedOption({ options: LOCAL, state: { selected: -1 } })).toBeUndefined()
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
      label: 'auditing the credential vault',
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
