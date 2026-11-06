import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { trackSlot, type SlotEnvironment } from '../placement'

type Rect = { left: number; top: number; width: number }

const slotAt = (args: { rect: Rect; layout: { width: number; height: number } }) => {
  const state = { rect: args.rect, layout: args.layout, reads: 0 }
  const element = document.createElement('div')
  element.getBoundingClientRect = () => {
    state.reads += 1
    return { ...state.rect, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
  }
  Object.defineProperty(element, 'offsetWidth', { get: () => state.layout.width })
  Object.defineProperty(element, 'offsetHeight', { get: () => state.layout.height })
  return { element, state }
}

const frame = (): HTMLElement => document.createElement('div')

const fakeEnvironment = () => {
  const resizers: Array<() => void> = []
  const listeners = new Map<string, Array<() => void>>()
  const environment: SlotEnvironment = {
    observeResize: ({ onResize }) => {
      resizers.push(onResize)
      return () => resizers.splice(resizers.indexOf(onResize), 1)
    },
    listen: ({ type, onEvent }) => {
      listeners.set(type, [...(listeners.get(type) ?? []), onEvent])
      return () =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((l) => l !== onEvent),
        )
    },
  }
  return {
    environment,
    resize: () => {
      for (const resizer of [...resizers]) resizer()
    },
    emit: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
    resizerCount: () => resizers.length,
  }
}

describe('trackSlot', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  it('places the frame once and does not measure again until something fires', () => {
    const { element, state } = slotAt({
      rect: { left: 10, top: 20, width: 400 },
      layout: { width: 400, height: 300 },
    })
    const target = frame()
    const fake = fakeEnvironment()

    trackSlot({ slot: element, frameOf: () => target, environment: fake.environment })

    expect(target.style.left).toBe('10px')
    expect(target.style.top).toBe('20px')
    expect(state.reads).toBe(1)
  })

  it('re-places the frame when the slot resizes', () => {
    const { element, state } = slotAt({
      rect: { left: 10, top: 20, width: 400 },
      layout: { width: 400, height: 300 },
    })
    const target = frame()
    const fake = fakeEnvironment()
    trackSlot({ slot: element, frameOf: () => target, environment: fake.environment })

    state.rect = { left: 10, top: 20, width: 500 }
    state.layout = { width: 500, height: 320 }
    fake.resize()

    expect(target.style.width).toBe('500px')
    expect(target.style.height).toBe('320px')
  })

  it.each(['scroll', 'resize', 'transitionend', 'animationend'])(
    're-places the frame on %s',
    (type) => {
      const { element, state } = slotAt({
        rect: { left: 10, top: 20, width: 400 },
        layout: { width: 400, height: 300 },
      })
      const target = frame()
      const fake = fakeEnvironment()
      trackSlot({ slot: element, frameOf: () => target, environment: fake.environment })

      state.rect = { left: 10, top: 90, width: 400 }
      fake.emit(type)

      expect(target.style.top).toBe('90px')
    },
  )

  it('places a frame that was not mounted yet when asked to remeasure', () => {
    const { element } = slotAt({
      rect: { left: 5, top: 6, width: 100 },
      layout: { width: 100, height: 50 },
    })
    let mounted: HTMLElement | undefined
    const fake = fakeEnvironment()
    const tracker = trackSlot({
      slot: element,
      frameOf: () => mounted,
      environment: fake.environment,
    })

    mounted = frame()
    tracker.remeasure()

    expect(mounted.style.left).toBe('5px')
  })

  it('stops listening once stopped', () => {
    const { element } = slotAt({
      rect: { left: 0, top: 0, width: 100 },
      layout: { width: 100, height: 50 },
    })
    const fake = fakeEnvironment()

    trackSlot({ slot: element, frameOf: () => frame(), environment: fake.environment }).stop()

    expect(fake.listenerCount()).toBe(0)
    expect(fake.resizerCount()).toBe(0)
  })
})
