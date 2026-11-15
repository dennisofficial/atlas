import type { SlotEnvironment } from '../../placement'
import type { PaneCommand } from '../pane-command'
import type { SamplePoint } from '../pane-geometry'
import type { PaneEnvironment, PaneSender } from '../pane-sync'

export type Rect = { left: number; top: number; width: number; height: number }

export const URL_A = 'https://example.com/a'
export const RECT: Rect = { left: 512, top: 64, width: 704, height: 832 }

export const settle = () => new Promise<void>((done) => setTimeout(done, 0))

export const slotAt = (rect: Rect) => {
  const state = { rect }
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({
    ...state.rect,
    x: state.rect.left,
    y: state.rect.top,
    right: state.rect.left + state.rect.width,
    bottom: state.rect.top + state.rect.height,
    toJSON: () => ({}),
  })
  const place = (next: Rect) => {
    state.rect = next
  }
  return { element, place }
}

export const fakeEnvironment = (topAt: (point: SamplePoint) => Element | null = () => null) => {
  const resizers: Array<() => void> = []
  const listeners = new Map<string, Array<() => void>>()
  const documents: Array<() => void> = []
  const frames = new Map<number, () => void>()
  let handles = 0
  const base: SlotEnvironment = {
    observeResize: ({ onResize }) => {
      resizers.push(onResize)
      return () => resizers.splice(resizers.indexOf(onResize), 1)
    },
    listen: ({ type, onEvent }) => {
      listeners.set(type, [...(listeners.get(type) ?? []), onEvent])
      return () =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((held) => held !== onEvent),
        )
    },
  }
  const environment: PaneEnvironment = {
    ...base,
    requestFrame: (run) => {
      handles += 1
      frames.set(handles, run)
      return handles
    },
    cancelFrame: (handle) => {
      frames.delete(handle)
    },
    topAt,
    observeDocument: (onChange) => {
      documents.push(onChange)
      return () => documents.splice(documents.indexOf(onChange), 1)
    },
  }
  return {
    environment,
    resize: () => {
      for (const resizer of [...resizers]) resizer()
    },
    emit: (type: string) => {
      for (const onEvent of [...(listeners.get(type) ?? [])]) onEvent()
    },
    paint: () => {
      const runs = [...frames.entries()]
      frames.clear()
      for (const [, run] of runs) run()
    },
    mutate: () => {
      for (const onChange of [...documents]) onChange()
    },
    frameCount: () => frames.size,
    watcherCount: () => resizers.length + documents.length,
  }
}

export const recorder = () => {
  const sent: PaneCommand[] = []
  const send: PaneSender = async (command) => {
    sent.push(command)
    return true
  }
  return { sent, send }
}

export const deferred = () => {
  const sent: PaneCommand[] = []
  const releases: Array<() => void> = []
  const send: PaneSender = (command) => {
    sent.push(command)
    return new Promise<boolean>((resolve) => releases.push(() => resolve(true)))
  }
  const settleAll = async () => {
    while (releases.length > 0) {
      for (const release of releases.splice(0)) release()
      await settle()
    }
  }
  return { sent, send, settle: settleAll }
}

export const orderedSender = () => {
  const sent: PaneCommand[] = []
  const releases: Array<() => void> = []
  let tail: Promise<boolean> = Promise.resolve(true)
  const send: PaneSender = (command) => {
    sent.push(command)
    const held = sent.length === 1
    const delivered = tail.then(async () => {
      if (held) await new Promise<void>((done) => releases.push(done))
      return true
    })
    tail = delivered
    return delivered
  }
  const releaseFirst = () => {
    for (const release of releases.splice(0)) release()
  }
  return { sent, send, releaseFirst }
}
