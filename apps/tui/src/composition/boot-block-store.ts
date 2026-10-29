import type { ThreadId } from '@dltech/atlas-core'

import type { AtlasApp } from './compose'
import {
  activateMoveRow,
  beginMove,
  expandMove,
  failMove,
  relabelMoveRow,
  settleMoveNode,
  startMoveNode,
  updateMoveTransfer,
  type ContainerMove,
} from './container-move'
import type { ContainerMoveControl } from './use-container-move'

export type BootNarration = Pick<
  ContainerMoveControl,
  | 'handleBegin'
  | 'handleNodeStart'
  | 'handleNodeDone'
  | 'handleTransferProgress'
  | 'handleRowActive'
  | 'handleRowLabel'
  | 'handleExpand'
  | 'handleSettle'
  | 'handleFail'
>

export type BootBlock = {
  threadId: ThreadId
  move: ContainerMove
  cancel: (() => void) | undefined
}

export type BootBlockStore = {
  snapshot: () => BootBlock | null
  subscribe: (listener: () => void) => () => void
  narrationFor: (args: { threadId: ThreadId }) => BootNarration
  inFlight: (args: { threadId: ThreadId }) => boolean
  handleCancel: () => boolean
  handleEscape: (args: { draftEmpty: boolean }) => boolean
}

const stores = new WeakMap<object, BootBlockStore>()

function createStore(): BootBlockStore {
  const listeners = new Set<() => void>()
  let held: BootBlock | null = null

  const put = (next: BootBlock | null): void => {
    if (next === held) return
    held = next
    for (const listener of [...listeners]) listener()
  }

  const update = (args: { threadId: ThreadId; change: (move: ContainerMove) => ContainerMove }) => {
    if (held === null || held.threadId !== args.threadId) return
    const move = args.change(held.move)
    if (move !== held.move) put({ ...held, move })
  }

  const narrationFor = ({ threadId }: { threadId: ThreadId }): BootNarration => ({
    handleBegin: (begin) => {
      if (held !== null && held.move.failure === null) return
      put({
        threadId,
        cancel: begin.onCancel,
        move: beginMove({
          target: begin.target,
          now: Date.now(),
          rows: begin.rows,
          cancellable: begin.onCancel !== undefined,
          heading: begin.heading,
        }),
      })
    },
    handleNodeStart: (nodeId) =>
      update({ threadId, change: (move) => startMoveNode({ move, nodeId, now: Date.now() }) }),
    handleNodeDone: (nodeId) =>
      update({ threadId, change: (move) => settleMoveNode({ move, nodeId, now: Date.now() }) }),
    handleTransferProgress: (progress) =>
      update({ threadId, change: (move) => updateMoveTransfer({ move, progress }) }),
    handleRowActive: (id) =>
      update({ threadId, change: (move) => activateMoveRow({ move, id, now: Date.now() }) }),
    handleRowLabel: ({ nodeId, text }) =>
      update({ threadId, change: (move) => relabelMoveRow({ move, nodeId, text }) }),
    handleExpand: ({ insertBefore, row, heading }) =>
      update({
        threadId,
        change: (move) => expandMove({ move, insertBefore, row, heading, now: Date.now() }),
      }),
    handleSettle: () => {
      if (held?.threadId === threadId) put(null)
    },
    handleFail: (reason) => update({ threadId, change: (move) => failMove({ move, reason }) }),
  })

  return {
    snapshot: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    narrationFor,
    inFlight: ({ threadId }) => held?.threadId === threadId && held.move.failure === null,
    handleCancel: () => {
      const block = held
      if (block === null || block.move.failure !== null || block.cancel === undefined) return false
      put(null)
      block.cancel()
      return true
    },
    handleEscape: ({ draftEmpty }) => {
      const block = held
      if (block === null) return false
      if (block.move.failure !== null) {
        put(null)
        return true
      }
      if (!draftEmpty || block.cancel === undefined) return false
      put(null)
      block.cancel()
      return true
    },
  }
}

export function bootBlocks(app: Pick<AtlasApp, 'sessionOwner'>): BootBlockStore {
  const existing = stores.get(app.sessionOwner)
  if (existing !== undefined) return existing
  const created = createStore()
  stores.set(app.sessionOwner, created)
  return created
}
