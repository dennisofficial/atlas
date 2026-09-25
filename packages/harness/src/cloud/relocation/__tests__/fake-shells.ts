import { toThreadId, type EKilledBy, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { EShellStatus, type ShellSnapshot } from '../../../shells/background-shell'
import { ENotice, type PendingShellNotice } from '../../../shells/notice-queue'
import { ShellRegistryPort } from '../../../shells/shell-registry'

export type FakeShells = ShellRegistryPort & {
  place: (snapshot: ShellSnapshot, owner?: ThreadId) => void
  print: (args: { shellId: string; text: string }) => void
  announce: (snapshot: ShellSnapshot, owner?: ThreadId) => void
  poke: () => void
  readonly killed: readonly string[]
  readonly removed: readonly { shellId: string; by: EKilledBy }[]
}

const NO_NOTICES: readonly PendingShellNotice[] = Object.freeze([])

export const FAKE_SHELL_OWNER = toThreadId('opened-thread')

type OwnedShell = { snapshot: ShellSnapshot; threadId: ThreadId }

export function fakeShellRegistry(): FakeShells {
  const owned: OwnedShell[] = []
  const printed = new Map<string, string>()
  const killed: string[] = []
  const removed: { shellId: string; by: EKilledBy }[] = []
  const listeners = new Set<() => void>()
  const revisionListeners = new Set<() => void>()
  let revision = 0
  let ended: readonly OwnedShell[] = []

  const bump = (): void => {
    revision += 1
    for (const listener of [...revisionListeners]) listener()
  }

  const settle = (next: readonly OwnedShell[]): void => {
    ended = next
    for (const listener of [...listeners]) listener()
  }

  const noticedBy = new Map<ThreadId, readonly PendingShellNotice[]>()
  const notices = (threadId: ThreadId): readonly PendingShellNotice[] => {
    const mine = ended
      .filter((one) => one.threadId === threadId)
      .map((one) => ({ kind: ENotice.Ended, snapshot: one.snapshot }))
    if (mine.length === 0) {
      noticedBy.delete(threadId)
      return NO_NOTICES
    }

    const held = noticedBy.get(threadId)
    if (
      held !== undefined &&
      held.length === mine.length &&
      held.every((notice, at) => notice.snapshot === mine[at]?.snapshot)
    ) {
      return held
    }

    noticedBy.set(threadId, mine)
    return mine
  }

  const find = (shellId: string, threadId: ThreadId): ShellSnapshot | undefined =>
    owned.find((one) => one.snapshot.shellId === shellId && one.threadId === threadId)?.snapshot

  return {
    get killed() {
      return killed
    },

    get removed() {
      return removed
    },

    place: (snapshot, owner = FAKE_SHELL_OWNER) => {
      owned.push({ snapshot, threadId: owner })
      bump()
    },

    print: ({ shellId, text }) => {
      printed.set(shellId, text)
      bump()
    },

    announce: (snapshot, owner = FAKE_SHELL_OWNER) => {
      owned.push({ snapshot, threadId: owner })
      settle([...ended, { snapshot, threadId: owner }])
      bump()
    },

    version: () => revision,

    subscribe: (listener) => {
      revisionListeners.add(listener)
      return () => void revisionListeners.delete(listener)
    },

    poke: () => bump(),

    start: () => ({ ok: false, reason: 'the fake registry starts no processes' }),

    read: ({ shellId, threadId }) => {
      const snapshot = find(shellId, threadId)
      if (snapshot === undefined) return { ok: false, reason: `no shell ${shellId}` }
      return {
        ok: true,
        snapshot,
        delta: { text: '', droppedCharacters: 0, remainingCharacters: 0 },
      }
    },

    peek: ({ shellId, threadId }) =>
      find(shellId, threadId) === undefined
        ? undefined
        : (printed.get(shellId) ?? `output of ${shellId}`),

    kill: ({ shellId, threadId }) => {
      const snapshot = find(shellId, threadId)
      if (snapshot === undefined) return { ok: false, reason: `no shell ${shellId}` }
      killed.push(shellId)
      return { ok: true, snapshot }
    },

    awaitEndings: () => Promise.resolve(0),

    removeShells: ({ threadId, shellIds, by }) => {
      let removedAny = false
      for (let index = owned.length - 1; index >= 0; index -= 1) {
        const one = owned[index]
        if (one === undefined || one.threadId !== threadId) continue
        if (!shellIds.includes(one.snapshot.shellId)) continue
        if (one.snapshot.status === EShellStatus.Running) killed.push(one.snapshot.shellId)
        removed.push({ shellId: one.snapshot.shellId, by })
        owned.splice(index, 1)
        removedAny = true
      }
      const keptEnded = ended.filter(
        (one) => one.threadId !== threadId || !shellIds.includes(one.snapshot.shellId),
      )
      if (keptEnded.length !== ended.length) settle(keptEnded)
      if (removedAny) bump()
    },

    list: ({ threadId }) =>
      owned.filter((one) => one.threadId === threadId).map((one) => one.snapshot),

    listEverywhere: () => owned.map((one) => one.snapshot),

    threadsAwaitingNotice: () => [...new Set(ended.map((one) => one.threadId))],

    drainNotifications: ({ threadId }) => {
      const handed = ended.filter((one) => one.threadId === threadId)
      if (handed.length === 0) return []

      settle(ended.filter((one) => one.threadId !== threadId))
      return handed.map(({ snapshot }): EventDraft => ({
        type: 'background-shell-ended',
        shellId: snapshot.shellId,
        command: snapshot.command,
        description: snapshot.description,
        status: snapshot.status,
        exitCode: snapshot.exitCode,
        output: `output of ${snapshot.shellId}`,
        droppedCharacters: 0,
        remainingCharacters: 0,
      }))
    },

    pendingNotices: ({ threadId }) => notices(threadId),

    onNotice: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    forgetNotices: ({ threadId }) => {
      const kept = ended.filter((one) => one.threadId !== threadId)
      if (kept.length === ended.length) return
      settle(kept)
    },

    closeAll: async () => {},

    recordEndings: async () => [],

    threadsWithUnresolvedEndings: () => [],
  }
}
