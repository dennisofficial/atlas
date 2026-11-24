import { describe, expect, it } from 'bun:test'

import type { Event } from '../../events/envelope'
import {
  decideResizeWait,
  EResizeWait,
  EPodResizeProbe,
  openPodResize,
  POD_RESIZE_ARM_PROBE_MS,
  POD_RESIZE_HARD_CAP_MS,
  POD_RESIZE_SOFT_PROBE_MS,
} from '../pod-resize-state'

const started = (args: { at: number; generation?: number }): Event =>
  ({
    type: 'pod-resize-started',
    generation: args.generation ?? 3,
    vcpus: 16,
    memoryGb: 64,
    at: new Date(args.at).toISOString(),
    seq: 1,
    threadId: 'thr_1',
    id: 'evt_1',
    runId: 'run_1',
    depth: 0,
  }) as unknown as Event

const resized = (args: { at: number; generation?: number }): Event =>
  ({
    type: 'pod-resized',
    generation: args.generation ?? 3,
    vcpus: 16,
    memoryGb: 64,
    outcome: 'applied',
    at: new Date(args.at).toISOString(),
    seq: 2,
    threadId: 'thr_1',
    id: 'evt_2',
    runId: 'run_1',
    depth: 0,
  }) as unknown as Event

const T0 = 1_700_000_000_000

describe('openPodResize', () => {
  it('is closed when no resize started', () => {
    expect(openPodResize([])).toBeUndefined()
    expect(openPodResize([resized({ at: T0 })])).toBeUndefined()
  })

  it('opens on a start and carries its shape and time', () => {
    expect(openPodResize([started({ at: T0 })])).toEqual({
      generation: 3,
      vcpus: 16,
      memoryGb: 64,
      startedAt: T0,
    })
  })

  it('closes on the resize of its own generation', () => {
    expect(openPodResize([started({ at: T0 }), resized({ at: T0 + 1_000 })])).toBeUndefined()
  })

  it('closes on a newer generation than its own', () => {
    expect(
      openPodResize([started({ at: T0 }), resized({ at: T0 + 1_000, generation: 4 })]),
    ).toBeUndefined()
  })

  it('stays open on an older generation', () => {
    expect(
      openPodResize([started({ at: T0 }), resized({ at: T0 + 1_000, generation: 2 })]),
    ).toEqual({ generation: 3, vcpus: 16, memoryGb: 64, startedAt: T0 })
  })

  it('opens again on a newer start after a finished resize', () => {
    expect(
      openPodResize([
        started({ at: T0 }),
        resized({ at: T0 + 1_000 }),
        started({ at: T0 + 2_000, generation: 4 }),
      ]),
    ).toEqual({ generation: 4, vcpus: 16, memoryGb: 64, startedAt: T0 + 2_000 })
  })
})

describe('decideResizeWait', () => {
  const open = { generation: 3, vcpus: 16, memoryGb: 64, startedAt: T0 }

  it('proceeds when no resize is open', () => {
    expect(
      decideResizeWait({ open: undefined, now: T0, probe: EPodResizeProbe.Updating, probes: 1 }),
    ).toEqual({ wait: EResizeWait.Proceed })
  })

  it('proceeds when the probe finds the pod at its target', () => {
    expect(
      decideResizeWait({ open, now: T0 + 60_000, probe: EPodResizeProbe.AtTarget, probes: 1 }),
    ).toEqual({ wait: EResizeWait.Proceed })
  })

  it('probes at once when the gate arms on a resize older than 30 s', () => {
    expect(decideResizeWait({ open, now: T0 + 60_000, probe: undefined, probes: 0 })).toEqual({
      wait: EResizeWait.Wait,
      checkAt: T0 + 60_000,
      probe: true,
    })
  })

  it('waits for the arm probe when a fresh resize arms the gate', () => {
    expect(decideResizeWait({ open, now: T0 + 1_000, probe: undefined, probes: 0 })).toEqual({
      wait: EResizeWait.Wait,
      checkAt: T0 + POD_RESIZE_ARM_PROBE_MS,
      probe: false,
    })
  })

  it('waits to the soft deadline after the first probe found nothing yet', () => {
    expect(
      decideResizeWait({
        open,
        now: T0 + 2 * 60_000,
        probe: EPodResizeProbe.Updating,
        probes: 1,
      }),
    ).toEqual({ wait: EResizeWait.Wait, checkAt: T0 + POD_RESIZE_SOFT_PROBE_MS, probe: false })
  })

  it('probes once more at five minutes', () => {
    expect(
      decideResizeWait({
        open,
        now: T0 + POD_RESIZE_SOFT_PROBE_MS,
        probe: EPodResizeProbe.Updating,
        probes: 1,
      }),
    ).toEqual({
      wait: EResizeWait.Wait,
      checkAt: T0 + POD_RESIZE_SOFT_PROBE_MS,
      probe: true,
    })
  })

  it('waits for the hard cap after the second probe', () => {
    expect(
      decideResizeWait({
        open,
        now: T0 + 6 * 60_000,
        probe: EPodResizeProbe.NotAtTarget,
        probes: 2,
      }),
    ).toEqual({ wait: EResizeWait.Wait, checkAt: T0 + POD_RESIZE_HARD_CAP_MS, probe: false })
  })

  it('treats an unknown probe as unfinished and keeps the soft deadline', () => {
    expect(
      decideResizeWait({ open, now: T0 + 60_000, probe: EPodResizeProbe.Unknown, probes: 1 }),
    ).toEqual({ wait: EResizeWait.Wait, checkAt: T0 + POD_RESIZE_SOFT_PROBE_MS, probe: false })
  })

  it('proceeds at the hard cap', () => {
    expect(
      decideResizeWait({
        open,
        now: T0 + POD_RESIZE_HARD_CAP_MS,
        probe: EPodResizeProbe.Updating,
        probes: 2,
      }),
    ).toEqual({ wait: EResizeWait.Proceed })
  })

  it('caps above the provider resize request timeout', () => {
    expect(POD_RESIZE_HARD_CAP_MS).toBeGreaterThan(15 * 60_000)
  })
})
