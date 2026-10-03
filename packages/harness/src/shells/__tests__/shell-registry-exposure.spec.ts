import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, type PortExposure } from '@dltech/atlas-core'

import {
  recorded,
  closeRegistries,
  job,
  localShellAdapter,
  openRegistry,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

const EXPOSURE: PortExposure = {
  containerPort: 3000,
  hostPort: 41_237,
  url: 'http://localhost:41237',
}

describe('a background shell with an exposed port', async () => {
  it('carries the mapping on its snapshot from the moment it starts', async () => {
    const { registry, log } = openRegistry({ adapter: localShellAdapter })

    const started = await registry.start({ ...job({ command: 'sleep 60' }), exposure: EXPOSURE })
    if (!started.ok) throw new Error(started.reason)

    expect(started.snapshot.exposure).toEqual(EXPOSURE)
    expect(registry.list({ threadId: THREAD })[0]?.exposure).toEqual(EXPOSURE)
  })

  it('carries no mapping on a shell that never asked for one', async () => {
    const { registry, log } = openRegistry({ adapter: localShellAdapter })

    const started = await registry.start(job({ command: 'sleep 60' }))
    if (!started.ok) throw new Error(started.reason)

    expect(started.snapshot.exposure).toBeUndefined()
  })

  it('keeps the mapping on the ending event the log records', async () => {
    const { registry, log } = openRegistry({ adapter: localShellAdapter })

    const started = await registry.start({ ...job({ command: 'sleep 60' }), exposure: EXPOSURE })
    if (!started.ok) throw new Error(started.reason)

    registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
    await recorded({ log })

    const ended = (log?.appended ?? []).find((draft) => draft.type === 'background-shell-ended')
    expect(ended).toMatchObject({ status: EShellStatus.Killed })
    // The exposure rides the shell's snapshot, not the event payload; the listing still has it.
    const listed = registry
      .list({ threadId: THREAD })
      .find((snapshot) => snapshot.shellId === started.snapshot.shellId)
    expect(listed?.exposure).toEqual(EXPOSURE)
  })
})
