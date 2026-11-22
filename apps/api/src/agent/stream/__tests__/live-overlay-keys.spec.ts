import { describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { LiveOverlay, type OverlayTarget } from '../overlay/live-overlay'
import { systemHostTimers } from '../system-timers'
import { FakeLiveSource, type TestFrame } from './fake-live-source'
import { until } from './until'

const SESSION = 'overlay-session'
const CHILD = 'overlay-child-thread'
const KEY: StreamStepKey = { runId: 'run-1', step: 0, attempt: 0 }

type Recorder = OverlayTarget & { sent: StreamServerMessage[] }

const recorderOf = (args: { id: string; liveKey: string }): Recorder => {
  const sent: StreamServerMessage[] = []
  return {
    id: args.id,
    sessionId: SESSION,
    liveKey: args.liveKey,
    sent,
    send: (message) => sent.push(message),
    bufferedAmount: () => 0,
  }
}

const delta = (args: { from: number; text: string }): TestFrame => ({
  type: 'delta',
  key: KEY,
  block: 'b1',
  kind: EStreamBlockKind.Text,
  from: args.from,
  text: args.text,
})

const overlayText = (recorder: Recorder): string =>
  recorder.sent
    .flatMap((message) =>
      message.type === 'overlay'
        ? message.blocks.flatMap((block) =>
            block.kind === EStreamBlockKind.Text ? [block.text] : [],
          )
        : [],
    )
    .join('')

const deltas = (recorder: Recorder): string[] =>
  recorder.sent.flatMap((message) => (message.type === 'delta' ? [message.text] : []))

const seedStep = (live: FakeLiveSource, args: { key: string; text: string }): void => {
  live.publish({
    key: args.key,
    frame: { type: 'step-start', key: KEY, afterSeq: 0 },
    deliver: false,
  })
  live.publish({
    key: args.key,
    frame: delta({ from: 0, text: args.text }),
    deliver: false,
  })
}

describe('live overlay by live key', () => {
  it('delivers frames published on a child key only to the child target', async () => {
    const live = new FakeLiveSource()
    seedStep(live, { key: CHILD, text: 'child ' })
    seedStep(live, { key: SESSION, text: 'main ' })
    const overlay = new LiveOverlay({ source: live, timers: systemHostTimers, log: undefined })
    const main = recorderOf({ id: 'main', liveKey: SESSION })
    const child = recorderOf({ id: 'child', liveKey: CHILD })
    overlay.add(main)
    overlay.add(child)
    await until(() => live.subscribed.has(SESSION) && live.subscribed.has(CHILD), 'both keys')
    await until(() => overlayText(child) === 'child ' && overlayText(main) === 'main ', 'joining')

    live.publish({ key: CHILD, frame: delta({ from: 6, text: 'delta' }) })
    await until(() => deltas(child).join('') === 'delta', 'the child delta')
    expect(overlayText(main)).toBe('main ')
    expect(deltas(main)).toEqual([])
    overlay.close()
  })

  it('replays the buffer of the key each target follows', async () => {
    const live = new FakeLiveSource()
    seedStep(live, { key: CHILD, text: 'child so far' })
    seedStep(live, { key: SESSION, text: 'main so far' })

    const overlay = new LiveOverlay({ source: live, timers: systemHostTimers, log: undefined })
    const main = recorderOf({ id: 'main', liveKey: SESSION })
    const child = recorderOf({ id: 'child', liveKey: CHILD })
    overlay.add(main)
    overlay.add(child)

    await until(() => overlayText(child) === 'child so far', 'the child snapshot')
    await until(() => overlayText(main) === 'main so far', 'the main snapshot')
    expect(overlayText(child)).toBe('child so far')
    expect(overlayText(main)).toBe('main so far')
    overlay.close()
  })

  it('keeps a child entry live when the main view reports the holder lost', async () => {
    const live = new FakeLiveSource()
    const dead: string[] = []
    const overlay = new LiveOverlay({
      source: live,
      timers: systemHostTimers,
      log: undefined,
      onFrameWhileDead: (sessionId) => dead.push(sessionId),
    })
    seedStep(live, { key: CHILD, text: 'child ' })
    const main = recorderOf({ id: 'main', liveKey: SESSION })
    const child = recorderOf({ id: 'child', liveKey: CHILD })
    overlay.add(main)
    overlay.add(child)
    await until(() => overlayText(child) === 'child ', 'the child snapshot')

    overlay.liveness({ sessionId: SESSION, live: false })
    live.publish({ key: CHILD, frame: delta({ from: 6, text: 'still running' }) })
    await until(() => deltas(child).join('') === 'still running', 'the child delta while dead')
    expect(dead).toEqual([])

    live.publish({ key: SESSION, frame: { type: 'step-start', key: KEY, afterSeq: 0 } })
    expect(dead).toEqual([SESSION])
    expect(main.sent).toEqual([])
    overlay.close()
  })

  it('unsubscribes only the key its last target followed', async () => {
    const live = new FakeLiveSource()
    const overlay = new LiveOverlay({ source: live, timers: systemHostTimers, log: undefined })
    const main = recorderOf({ id: 'main', liveKey: SESSION })
    const child = recorderOf({ id: 'child', liveKey: CHILD })
    overlay.add(main)
    overlay.add(child)
    await until(() => live.subscribed.has(SESSION) && live.subscribed.has(CHILD), 'both keys')

    overlay.remove(child)
    await until(() => !live.subscribed.has(CHILD), 'the child key released')
    expect(live.subscribed.has(SESSION)).toBe(true)

    live.publish({ key: CHILD, frame: delta({ from: 0, text: 'after leaving' }) })
    expect(deltas(child)).toEqual([])

    overlay.remove(main)
    await until(() => !live.subscribed.has(SESSION), 'the main key released')
    overlay.close()
  })

  it('ends a child step with the step-end frame it published', async () => {
    const live = new FakeLiveSource()
    seedStep(live, { key: CHILD, text: 'done' })
    const overlay = new LiveOverlay({ source: live, timers: systemHostTimers, log: undefined })
    const child = recorderOf({ id: 'child', liveKey: CHILD })
    overlay.add(child)
    await until(() => overlayText(child) === 'done', 'the child snapshot')

    live.publish({
      key: CHILD,
      frame: { type: 'step-end', key: KEY, reason: EStepEndReason.Finished },
    })
    await until(() => child.sent.some((message) => message.type === 'frame'), 'the step-end frame')
    expect(child.sent.filter((message) => message.type === 'frame')).toMatchObject([
      { frame: { type: 'step-end', reason: EStepEndReason.Finished } },
    ])
    overlay.close()
  })
})
