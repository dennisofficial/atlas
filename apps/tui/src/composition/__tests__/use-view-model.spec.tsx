import { EEffort, refKey, toThreadId, type ModelCard, type ThreadId } from '@dltech/atlas-core'
import type { ModelSelection } from '@dltech/atlas-harness'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { useViewModel, type ViewModelControl } from '../use-view-model'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const THREAD: ThreadId = toThreadId('viewed-child')

const AT = '2026-08-25T00:00:00.000Z'

type Probe = { current: ViewModelControl | null }

type ViewArgs = { enabled: boolean; model?: { id: string; modelId: string } | undefined }

function Harness(args: { probe: Probe; app: FakeApp; view: ViewArgs }) {
  args.probe.current = useViewModel({
    app: args.app,
    threadId: THREAD,
    model: args.view.model,
    enabled: args.view.enabled,
  })
  return <box />
}

type Mounted = {
  setup: TestRendererSetup
  root: Root
  probe: Probe
  app: FakeApp
  render: (view: ViewArgs) => Promise<void>
}

const live: Mounted[] = []

async function mount(args: { view: ViewArgs; app?: FakeApp }): Promise<Mounted> {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const app = args.app ?? fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
  const probe: Probe = { current: null }
  const render = async (view: ViewArgs) => {
    await act(async () => {
      root.render(<Harness probe={probe} app={app} view={view} />)
      await setup.flush()
    })
  }
  await render(args.view)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  const mounted = { setup, root, probe, app, render }
  live.push(mounted)
  return mounted
}

async function settleWrites(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function seedRow(app: FakeApp, model?: { ref: string; effort: string }): void {
  app.threads.seedThread({
    id: THREAD,
    head: 0,
    createdAt: AT,
    updatedAt: AT,
    workspace: '/work',
    repo: null,
    ...(model === undefined ? {} : { model }),
  })
}

const choiceOn = (card: ModelCard, effort: EEffort): { ref: ModelCard['ref']; effort: EEffort } => ({
  ref: card.ref,
  effort,
})

const cardOf = (app: FakeApp, key: string): ModelCard => {
  const card = app.models.providers.flatMap((provider) => provider.cards).find((held) => refKey(held.ref) === key)
  if (card === undefined) throw new Error(`the fake catalogue holds no ${key}`)
  return card
}

afterEach(() => {
  const mounted = live.pop()
  if (mounted === undefined) return
  mounted.root.unmount()
  mounted.setup.renderer.destroy()
  dismissNotice()
})

describe('useViewModel', () => {
  it('shows the parent’s current choice for a child that carries no model of its own', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app)
    const { probe } = await mount({ view: { enabled: true }, app })

    expect(probe.current?.selection).toEqual(app.model.choice())
  })

  it('derives the selection from the snapshot identity when the row holds no model', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app)
    const { probe } = await mount({
      view: { enabled: true, model: { id: 'anthropic', modelId: 'claude-opus-5' } },
      app,
    })

    expect(probe.current?.selection?.ref).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-5' })
    expect(probe.current?.selection?.effort).toBe(app.model.choice().effort)
  })

  it('shows the model a spawned child was frozen with', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app, { ref: 'anthropic/claude-opus-5', effort: 'low' })
    const { probe } = await mount({ view: { enabled: true }, app })

    expect(probe.current?.selection?.ref).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-5' })
    expect(probe.current?.selection?.effort).toBe(EEffort.Low)
  })

  it('reads nothing while nobody is viewing a child', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    const { probe } = await mount({ view: { enabled: false }, app })

    expect(probe.current?.selection).toBeNull()

    act(() => probe.current?.handlePicked({ choice: choiceOn(cardOf(app, 'anthropic/claude-opus-5'), EEffort.High) }))
    await settleWrites()

    expect(app.threads.chosenModels).toEqual([])
  })

  it('writes a pick through chooseModel with retarget and keeps the selection', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app)
    const { probe } = await mount({ view: { enabled: true }, app })

    const calls: Parameters<FakeApp['threads']['chooseModel']>[0][] = []
    const inner = app.threads.chooseModel.bind(app.threads)
    app.threads.chooseModel = async (given) => {
      calls.push(given)
      return inner(given)
    }

    act(() => probe.current?.handlePicked({ choice: choiceOn(cardOf(app, 'anthropic/claude-opus-5'), EEffort.High) }))
    await settleWrites()

    expect(calls).toEqual([
      { threadId: THREAD, model: { ref: 'anthropic/claude-opus-5', effort: EEffort.High }, retarget: true },
    ])
    expect(probe.current?.selection?.ref).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-5' })
    expect(probe.current?.selection?.effort).toBe(EEffort.High)
  })

  it('restores the prior selection and says why when the store refuses the pick', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app)
    const { probe } = await mount({ view: { enabled: true }, app })
    const prior = probe.current?.selection ?? null
    expect(prior).not.toBeNull()

    const refusing: FakeApp['threads']['chooseModel'] = async () => {
      throw new Error('this child is not yours to retune')
    }
    app.threads.chooseModel = refusing

    act(() => probe.current?.handlePicked({ choice: choiceOn(cardOf(app, 'anthropic/claude-opus-5'), EEffort.High) }))
    await settleWrites()

    expect(probe.current?.selection).toEqual(prior)
    expect(currentNotices().some((notice) => notice.text === 'this child is not yours to retune')).toBe(true)
  })

  it('ignores a model chosen for another thread', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app)
    const { probe } = await mount({ view: { enabled: true }, app })
    const before = probe.current?.selection ?? null

    await act(async () => {
      await app.threads.chooseModel({
        threadId: toThreadId('someone-else'),
        model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
      })
    })
    await settleWrites()

    expect(probe.current?.selection).toEqual(before)
  })

  it('follows a model chosen for the viewed thread', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
    seedRow(app)
    const { probe } = await mount({ view: { enabled: true }, app })

    await act(async () => {
      await app.threads.chooseModel({
        threadId: THREAD,
        model: { ref: 'anthropic/claude-opus-5', effort: 'low' },
      })
    })
    await settleWrites()

    const selection: ModelSelection | null = probe.current?.selection ?? null
    expect(selection?.ref).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-5' })
    expect(selection?.effort).toBe(EEffort.Low)
  })
})
