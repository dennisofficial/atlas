import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { ESettingId, type SettingsDocument } from '@dltech/atlas-core'

import { scriptedModelPort } from './fake-app'
import { fakeApp, type FakeApp } from './fake-app'
import { useOnboarding, type OnboardingControl } from '../use-onboarding'

type Probe = {
  control: OnboardingControl | null
  chosen: string[]
  accountsOpened: number
}

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

async function hostWith(args: {
  probe: Probe
  settings?: SettingsDocument
}): Promise<void> {
  const app = fakeApp({
    model: scriptedModelPort({ script: [] }),
    ...(args.settings === undefined ? {} : { settings: args.settings }),
  })
  const session = await testRender(<Host app={app} probe={args.probe} />)
  await session.renderOnce()
  session.destroy()
}

describe('useOnboarding', () => {
  it('opens for a fresh install with no settings at all', async () => {
    const probe: Probe = { control: null, chosen: [], accountsOpened: 0 }
    await hostWith({ probe })

    expect(probe.control?.state).toEqual({ rowIndex: 0 })
    expect(probe.control?.ready).toBe(false)
    expect(probe.control?.rows.map((row) => row.key)).toEqual([
      'accounts',
      'default',
      'quick',
      'compaction',
      'subagents',
      'begin',
    ])
  })

  it('stays closed for an established install', async () => {
    const probe: Probe = { control: null, chosen: [], accountsOpened: 0 }
    await hostWith({ probe, settings: EVERYTHING_SET })

    expect(probe.control?.state).toBeNull()
  })

  it('is not ready until a provider is connected and all four models are picked', async () => {
    const probe: Probe = { control: null, chosen: [], accountsOpened: 0 }
    const app = fakeApp({
      model: scriptedModelPort({ script: [] }),
      settings: { values: { [ESettingId.ModelId]: 'anthropic/claude-sonnet-5' } },
    })
    const session = await testRender(<Host app={app} probe={probe} />)
    await session.renderOnce()

    expect(probe.control?.state).not.toBeNull()
    expect(probe.control?.ready).toBe(false)
    expect(probe.control?.rows.find((row) => row.key === 'default')?.done).toBe(true)
    expect(probe.control?.rows.find((row) => row.key === 'quick')?.done).toBe(false)

    session.destroy()
  })

  it('routes a model row to the picker and the accounts row to the overlay', async () => {
    const probe: Probe = { control: null, chosen: [], accountsOpened: 0 }
    const app = fakeApp({ model: scriptedModelPort({ script: [] }) })
    const session = await testRender(<Host app={app} probe={probe} />)
    await session.renderOnce()

    const control = probe.control
    if (control === null) throw new Error('no control')

    const rows = control.rows
    control.handleActivate(rows[1]!)
    control.handleActivate(rows[0]!)

    expect(probe.chosen).toEqual([ESettingId.ModelId])
    expect(probe.accountsOpened).toBe(1)

    session.destroy()
  })
})
