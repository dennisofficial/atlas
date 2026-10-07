import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act, useState } from 'react'

import { EAuthor, EEntryKind, type TranscriptModel } from '../../store'
import { Transcript } from '../components/transcript'
import { WINDOW_THRESHOLD } from '../entry-window'
import { grammarsReady, teardown } from '../markdown/__tests__/harness'
import { CWD, LAST_WORDS, NOW, SETTLED } from './transcript-fixture'
import { frameSettled, frameShowing } from './waiting'

await grammarsReady()

const WIDTH = 80
const HEIGHT = 12
const JUMP = 'jump to bottom'
const BIG_TAIL = 'the last windowed entry'
const SYNCED_TAIL = 'the latest output synchronized after connecting'
const BIG: TranscriptModel = {
  entries: Array.from({ length: WINDOW_THRESHOLD + 200 }, (_, index) => ({
    kind: EEntryKind.ModelSaid,
    author: EAuthor.Model,
    key: `reply-${index}`,
    text: index === WINDOW_THRESHOLD + 199 ? BIG_TAIL : `reply ${index}`,
    streaming: false,
    interrupted: false,
    muted: false,
  })),
  isEmpty: false,
  streaming: false,
  failure: null,
}

const view = (args: { model: TranscriptModel; connected: boolean }) => (
  <box flexDirection="column" width={WIDTH} height={HEIGHT}>
    <Transcript
      model={args.model}
      width={WIDTH}
      now={NOW}
      cwd={CWD}
      cloudConnected={args.connected}
    />
  </box>
)

type Setup = Awaited<ReturnType<typeof testRender>>

async function readHistory(setup: Setup): Promise<void> {
  await act(async () => {
    for (let notch = 0; notch < 10; notch += 1)
      await setup.mockMouse.scroll(20, 5, 'up')
    await setup.flush()
  })
  await frameShowing({ setup, text: JUMP })
}

async function mount(model: TranscriptModel) {
  type State = { model: TranscriptModel; connected: boolean }
  let update: (state: State) => void = () => {
    throw new Error('transcript not mounted')
  }
  function ControlledTranscript(): React.ReactNode {
    const [state, setState] = useState<State>({ model, connected: false })
    update = setState
    return view(state)
  }
  const setup = await testRender(<ControlledTranscript />, {
    width: WIDTH,
    height: HEIGHT,
  })
  return {
    setup,
    render: async (state: State): Promise<void> => {
      await act(async () => {
        update(state)
        await setup.flush()
      })
      await frameSettled({ setup })
    },
  }
}

describe('connecting the cloud transcript', () => {
  for (const scenario of [
    { label: 'a short transcript', model: SETTLED, tail: LAST_WORDS },
    { label: 'a windowed transcript', model: BIG, tail: BIG_TAIL },
  ]) {
    it(`jumps once on each successful connection for ${scenario.label}`, async () => {
      const { setup, render } = await mount(scenario.model)
      try {
        await frameShowing({ setup, text: scenario.tail })
        await readHistory(setup)
        expect(await frameSettled({ setup })).not.toContain(scenario.tail)

        await render({ model: scenario.model, connected: true })
        const landed = await frameShowing({ setup, text: scenario.tail })
        expect(landed).not.toContain(JUMP)

        await readHistory(setup)
        const updated = {
          ...scenario.model,
          entries: [...scenario.model.entries],
        }
        await render({ model: updated, connected: true })
        const stillReading = await frameSettled({ setup })
        expect(stillReading).toContain(JUMP)
        expect(stillReading).not.toContain(scenario.tail)

        await render({ model: updated, connected: false })
        expect(await frameSettled({ setup })).toContain(JUMP)
        await render({ model: updated, connected: true })
        expect(
          await frameShowing({ setup, text: scenario.tail }),
        ).not.toContain(JUMP)

        const synchronized: TranscriptModel = {
          ...updated,
          entries: [
            ...updated.entries,
            {
              kind: EEntryKind.ModelSaid,
              author: EAuthor.Model,
              key: 'synced-reply',
              text: SYNCED_TAIL,
              streaming: false,
              interrupted: false,
              muted: false,
            },
          ],
        }
        await render({ model: synchronized, connected: true })
        expect(await frameShowing({ setup, text: SYNCED_TAIL })).not.toContain(
          JUMP,
        )
      } finally {
        await teardown(setup)
      }
    }, 60_000)
  }
})
