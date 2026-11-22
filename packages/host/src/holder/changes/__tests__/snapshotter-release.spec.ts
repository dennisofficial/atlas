import { describe, expect, it } from 'bun:test'

import { ESnapshotTrigger } from '../snapshotter'
import { rig, singleFile, until } from './snapshotter-rig'

describe('the release path', () => {
  it('starts no snapshot run after the holder closes the daemon link', async () => {
    const state = singleFile()
    const { snapshotter, calls, errors, triggers } = await rig({ state })
    let open: () => void = () => undefined
    state.gate = () =>
      new Promise<void>((resolve) => {
        open = resolve
      })

    const turnEnd = snapshotter.snapshotNow(ESnapshotTrigger.TurnEnd)
    await until(() => state.scans === 1)
    void snapshotter.snapshotNow(ESnapshotTrigger.Rearm)
    snapshotter.quiesce()
    calls.close()
    state.gate = undefined
    open()
    await turnEnd
    await until(() => state.inFlight === 0)

    expect(state.scans).toBe(1)
    expect(errors).toEqual([])
    expect(triggers).toEqual(['turn-end'])
  })
})
