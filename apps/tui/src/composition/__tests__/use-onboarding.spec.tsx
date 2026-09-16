import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { ESettingId, type SettingsDocument } from '@dltech/atlas-core'

import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { EOnboardingRow, useOnboarding, type OnboardingControl } from '../use-onboarding'

type Probe = {
  control: OnboardingControl | null
  chosen: string[]
  accountsOpened: number
}

const probed = (): Probe => ({ control: null, chosen: [], accountsOpened: 0 })

function Host(props: { app: FakeApp; probe: Probe }): React.ReactNode {
  props.probe.control = useOnboarding({
    app: props.app,
    onChooseModel: (id) => {
      props.probe.chosen.push(id)
    },
    onOpenAccounts: () => {
      props.probe.accountsOpened += 1
    },
  })

  return <text>host</text>
}

const EVERYTHING_SET: SettingsDocument = {
  values: {
    [ESettingId.ModelId]: 'anthropic/claude-sonnet-5',
    [ESettingId.QuickModel]: 'anthropic/claude-haiku-4-5',
    [ESettingId.CompactionModel]: 'anthropic/claude-sonnet-5',
    [ESettingId.SubagentModel]: 'anthropic/claude-sonnet-5',
  },
}

const appOver = (settings?: SettingsDocument): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: '' } }),
    ...(settings === undefined ? {} : { settings }),
  })

async function mounted(
  app: FakeApp,
  probe: Probe,
): Promise<{ flush: () => Promise<void>; done: () => void }> {
  const setup = await testRender(<Host app={app} probe={probe} />, { width: 60, height: 8 })
  await setup.renderOnce()

  return { flush: setup.renderOnce, done: () => setup.renderer.destroy() }
}

describe('useOnboarding', () => {
  it('opens for a fresh install with no settings at all', async () => {
    const probe = probed()
    const { done } = await mounted(appOver(), probe)

    expect(probe.control?.state).toEqual({ rowIndex: 0 })
    expect(probe.control?.ready).toBe(false)
    expect(probe.control?.rows.map((row) => row.key)).toEqual([
      EOnboardingRow.Accounts,
      EOnboardingRow.Default,
      EOnboardingRow.Quick,
      EOnboardingRow.Compaction,
      EOnboardingRow.Subagents,
      EOnboardingRow.Begin,
    ])
    done()
  })

  it('stays closed for an established install', async () => {
    const probe = probed()
    const { done } = await mounted(appOver(EVERYTHING_SET), probe)

    expect(probe.control?.state).toBeNull()
    done()
  })

  it('is not ready until all four models are picked, even with a provider connected', async () => {
    const probe = probed()
    const app = appOver()
    const { flush, done } = await mounted(app, probe)

    await act(async () => {
      app.settings.set({ id: ESettingId.ModelId, value: 'anthropic/claude-sonnet-5' })
    })
    await flush()

    expect(probe.control?.state).not.toBeNull()
    expect(probe.control?.ready).toBe(false)
    expect(probe.control?.rows.find((row) => row.key === 'default')?.done).toBe(true)
    expect(probe.control?.rows.find((row) => row.key === 'quick')?.done).toBe(false)
    done()
  })

  it('routes a model row to the picker and the accounts row to the overlay', async () => {
    const probe = probed()
    const { done } = await mounted(appOver(), probe)
    const control = probe.control
    if (control === null) throw new Error('no control')

    control.handleActivate(control.rows[1]!)
    control.handleActivate(control.rows[0]!)

    expect(probe.chosen).toEqual([ESettingId.ModelId])
    expect(probe.accountsOpened).toBe(1)
    done()
  })

  it('turns ready as the picks land and closes on begin', async () => {
    const probe = probed()
    const app = appOver()
    const { flush, done } = await mounted(app, probe)

    const picks: readonly { id: ESettingId; value: string }[] = [
      { id: ESettingId.ModelId, value: 'anthropic/claude-sonnet-5' },
      { id: ESettingId.QuickModel, value: 'anthropic/claude-haiku-4-5' },
      { id: ESettingId.CompactionModel, value: 'anthropic/claude-sonnet-5' },
      { id: ESettingId.SubagentModel, value: 'anthropic/claude-sonnet-5' },
    ]
    await act(async () => {
      for (const pick of picks) {
        app.settings.set({ id: pick.id, value: pick.value })
      }
    })
    await flush()

    const control = probe.control
    if (control === null) throw new Error('no control')
    expect(control.ready).toBe(true)

    const begin = control.rows.at(-1)
    if (begin === undefined) throw new Error('no begin row')
    await act(async () => {
      control.handleActivate(begin)
    })
    await flush()

    expect(probe.control?.state).toBeNull()
    done()
  })
})
