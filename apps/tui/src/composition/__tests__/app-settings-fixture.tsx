import { ESettingId, toThreadId, type SettingsDocument } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'
import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

export const THREAD = toThreadId('opened-thread')

export const WIDE = { width: 150, height: 40 }

export type Mounted = Awaited<ReturnType<typeof testRender>>

export const appWith = (settings?: SettingsDocument): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    ...(settings === undefined ? {} : { settings }),
  })

export const widthOf = (sidebarWidth: number): SettingsDocument => ({
  values: { [ESettingId.SidebarWidth]: sidebarWidth },
})

export const columnOf = (setup: Mounted, needle: string): number => {
  const row = setup
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes(needle))

  return row === undefined ? -1 : row.indexOf(needle)
}

export const READ_MS = 60

export async function landed(setup: Mounted): Promise<void> {
  await settle(READ_MS)
  await setup.flush()
}

export async function opened(app: FakeApp): Promise<Mounted> {
  const setup = await testRender(<App app={app} opened={{ threadId: THREAD, events: [], turns: [], name: null, started: true }} />, WIDE)
  await setup.flush()
  await settle(250)
  await setup.flush()
  return setup
}

export async function onSettings(app: FakeApp): Promise<Mounted> {
  const setup = await opened(app)
  setup.mockInput.pressKey('o', { ctrl: true })
  await landed(setup)
  return setup
}

export const valueOf = (app: FakeApp, id: ESettingId): unknown =>
  app.settings.snapshot().resolution.settings.get(id)?.value

export const SIDEBAR_WIDTH_ROW = 7

export const DECISIONS_URL_ROW = 20

export async function downTo(args: { setup: Mounted; row: number }): Promise<void> {
  for (let step = 0; step < args.row; step += 1) {
    args.setup.mockInput.pressArrow('down')
    await landed(args.setup)
  }
}
