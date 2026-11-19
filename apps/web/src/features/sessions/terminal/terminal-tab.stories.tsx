import type { TerminalRow } from '@dltech/atlas-protocol'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import { paneValueFixture, populatedPaneValue } from '../panel/__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../panel/pane-value'
import type { TerminalTransportOf } from './terminal-api'
import { TerminalTab } from './terminal-tab'

const meta = {
  title: 'Sessions/Pane terminal',
  parameters: { layout: 'fullscreen' },
}

export default meta

const row = (overrides: Partial<TerminalRow> = {}): TerminalRow => ({
  terminalId: 't1',
  ordinal: 1,
  name: 'Terminal 1',
  state: 'open',
  exitCode: null,
  signal: null,
  endedReason: null,
  createdAt: 1,
  endedAt: null,
  ...overrides,
})

const scrollback = '$ ls\r\nsrc  package.json  bun.lock\r\n$ '

const fakeTransportOf =
  (rows: TerminalRow[], connection = ETerminalConnection.Connected): TerminalTransportOf =>
  (args) => ({
    list: async () => rows,
    open: async () => ({ state: 'open', terminalId: 't4', pid: 1 }),
    write: () => undefined,
    resize: () => undefined,
    close: async () => undefined,
    rename: async () => undefined,
    read: async () => ({
      offset: 0,
      data: btoa(scrollback),
      totalBytes: scrollback.length,
      exited: null,
    }),
    reconnect: () => args.onLink(connection),
    dispose: () => undefined,
  })

const pane = (value: SessionPaneValue, transportOf: TerminalTransportOf) => (
  <div className="h-[36rem] w-full max-w-xl border-r bg-card">
    <SessionPaneProvider value={value}>
      <TerminalTab transportOf={transportOf} />
    </SessionPaneProvider>
  </div>
)

export const Populated = {
  render: () =>
    pane(
      populatedPaneValue(),
      fakeTransportOf([
        row(),
        row({ terminalId: 't2', ordinal: 2, name: 'build' }),
        row({
          terminalId: 't3',
          ordinal: 3,
          name: 'Terminal 3',
          state: 'ended',
          exitCode: 3,
          endedReason: 'exited',
          endedAt: 2,
        }),
      ]),
    ),
}

export const Empty = {
  render: () => pane(paneValueFixture(), fakeTransportOf([])),
}

export const Asleep = {
  render: () =>
    pane(
      paneValueFixture({
        status: { state: 'idle', lease: { epoch: 1, holderHostId: 7, live: false } },
      } as never),
      fakeTransportOf([row()]),
    ),
}
