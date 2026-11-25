import { describe, expect, it } from 'bun:test'

import type { RecordEventBody } from '@dltech/atlas-core'

import { eventsOf, said } from './finding-fixtures'
import { FILE, analyticsRecorder, createRig, wroteWithChanges } from './support'

const WIDGET =
  'export class Widget {\n  run() {\n    return 1\n  }\n\n  audit() {\n    return 2\n  }\n}\n'

const secondWrite = async (after: string) => {
  const first = await createRig().run()
  const { captured, analytics } = analyticsRecorder()
  const events = eventsOf([...((first.drafts ?? []) as readonly RecordEventBody[]), said])
  const rig = createRig({ analytics, events: events as never })

  await rig.run({
    result: wroteWithChanges({ fileChanges: [{ path: FILE, before: WIDGET, after }] }),
  })

  return {
    closed: captured.filter((entry) => entry.event === 'quality finding closed'),
    resolved: captured.filter((entry) => entry.event === 'quality finding resolved'),
  }
}

describe('the closed event through the after-tool hook', () => {
  it('fires once when the next write removes the nudged class', async () => {
    const { closed, resolved } = await secondWrite('export const version = 1\n')

    expect(closed).toEqual([
      {
        event: 'quality finding closed',
        properties: {
          policy_id: 'single-responsibility',
          steps_after_nudge: 1,
          turns_after_nudge: 0,
        },
      },
    ])
    expect(resolved).toEqual([])
  })

  it('keeps the finding open when the class is only renamed', async () => {
    const { closed } = await secondWrite(WIDGET.replace('Widget', 'Gadget'))

    expect(closed).toEqual([])
  })

  it('closes the finding when a rename also changes the members', async () => {
    const renamed = WIDGET.replace('Widget', 'Gadget').replace('return 2', 'return 3')

    const { closed } = await secondWrite(renamed)

    expect(closed).toHaveLength(1)
  })
})
