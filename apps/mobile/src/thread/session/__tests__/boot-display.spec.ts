import { describe, expect, it } from 'bun:test'

import type { BootView } from '@dltech/atlas-client/session'
import { EBootStepState } from '@dltech/atlas-ui/sandbox-boot-copy'
import { EBootStep, EBootStepState as EWireBootStepState } from '@dltech/atlas-wire/web'

import { bootDisplayOf } from '../boot-display'

const viewOf = (overrides: Partial<BootView> = {}): BootView => ({
  steps: [
    { id: EBootStep.Provision, label: 'Sandbox started', state: EWireBootStepState.Done },
    { id: EBootStep.Serve, label: 'Daemon started', state: EWireBootStepState.Done },
    { id: EBootStep.Clone, label: 'Cloning repository', state: EWireBootStepState.Running },
    { id: EBootStep.Setup, label: 'Running setup script', state: EWireBootStepState.Pending },
  ],
  state: EWireBootStepState.Running,
  ...overrides,
})

describe('bootDisplayOf', () => {
  it('titles a running boot and counts the steps done so far', () => {
    const display = bootDisplayOf({ view: viewOf({ startedAtMs: 1_000 }), now: 13_400 })
    expect(display.title).toBe('Starting sandbox')
    expect(display.summary).toBe('2/4 · 12.4s')
    expect(display.state).toBe(EBootStepState.Running)
    expect(display.open).toBe(true)
    expect(display.failed).toBe(false)
    expect(display.steps.map((step) => step.state)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
    ])
  })

  it('summarises a finished boot with its recorded elapsed time and stays closed', () => {
    const display = bootDisplayOf({
      view: viewOf({
        state: EWireBootStepState.Done,
        elapsedMs: 4_200,
        steps: [
          { id: EBootStep.Provision, label: 'Sandbox started', state: EWireBootStepState.Done },
        ],
      }),
      now: 1_000_000,
    })
    expect(display.title).toBe('Sandbox ready')
    expect(display.summary).toBe('4.2s')
    expect(display.open).toBe(false)
  })

  it('prefers the view title, opens on failure and offers a retry', () => {
    const display = bootDisplayOf({
      view: viewOf({
        state: EWireBootStepState.Error,
        title: 'Setup script failed',
        error: 'bun install exited 1',
        steps: [
          { id: EBootStep.Provision, label: 'Sandbox started', state: EWireBootStepState.Done },
          {
            id: EBootStep.Setup,
            label: 'Running setup script',
            state: EWireBootStepState.Error,
            detail: 'bun install exited 1',
            command: 'bun install',
            output: 'boom',
          },
        ],
      }),
      now: 0,
    })
    expect(display.title).toBe('Setup script failed')
    expect(display.summary).toBeUndefined()
    expect(display.failed).toBe(true)
    expect(display.open).toBe(true)
    expect(display.headerError).toBeUndefined()
    expect(display.steps[1]?.command).toBe('bun install')
    expect(display.steps[1]?.output).toBe('boom')
  })

  it('lifts the failure to the header when no step carries it', () => {
    const display = bootDisplayOf({
      view: viewOf({
        state: EWireBootStepState.Error,
        error: 'The sandbox failed to start.',
        steps: [
          { id: EBootStep.Provision, label: 'Starting sandbox', state: EWireBootStepState.Error },
        ],
      }),
      now: 0,
    })
    expect(display.headerError).toBe('The sandbox failed to start.')
  })

  it('keeps the group open when a clone child failed', () => {
    const display = bootDisplayOf({
      view: viewOf({
        state: EWireBootStepState.Done,
        elapsedMs: 1_000,
        steps: [
          {
            id: EBootStep.Clone,
            label: 'Cloning repository',
            state: EWireBootStepState.Done,
            children: [
              {
                id: 'dltech/atlas',
                label: 'atlas',
                state: EWireBootStepState.Error,
                detail: 'repository not found',
              },
            ],
          },
        ],
      }),
      now: 0,
    })
    expect(display.open).toBe(true)
    expect(display.steps[0]?.children).toEqual([
      {
        id: 'dltech/atlas',
        label: 'atlas',
        state: EBootStepState.Error,
        detail: 'repository not found',
      },
    ])
  })

  it('reads an interrupted step as running and titles the restart', () => {
    const display = bootDisplayOf({
      view: viewOf({
        state: EWireBootStepState.Interrupted,
        steps: [
          {
            id: EBootStep.Setup,
            label: 'Setup restarted · running again',
            state: EWireBootStepState.Interrupted,
          },
        ],
      }),
      now: 0,
    })
    expect(display.state).toBe(EBootStepState.Interrupted)
    expect(display.title).toBe('Setup restarted · running again')
    expect(display.open).toBe(true)
  })
})
