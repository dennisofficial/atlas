import { EMessageOrigin, saidBody, type EventDraft, type SaidFile, type SaidImage } from '@dltech/atlas-core'
import type { InputBatch } from '../intake/input-batch'

export type PendingSaid = {
  text: string
  images: readonly SaidImage[]
  files: readonly SaidFile[]
  context?: readonly EventDraft[] | undefined
  via?: EMessageOrigin | undefined
}

export type PendingMessage = PendingSaid & { kind: 'message'; id: string }

export type PendingCommand<Command> = {
  kind: 'command'
  id: string
  text: string
  command: Command
}

export type PendingEntry<Command> = PendingMessage | PendingCommand<Command>

export type PendingQueue<Command = never> = {
  subscribe(listener: () => void): () => void
  getSnapshot(): readonly PendingEntry<Command>[]
  enqueue(args: { text: string; images?: readonly SaidImage[]; files?: readonly SaidFile[]; context?: readonly EventDraft[] | undefined; via?: EMessageOrigin | undefined }): void
  prepare(): InputBatch
  enqueueCommand(args: { text: string; command: Command }): void
  takeBackLast(): PendingSaid | null
  drain(): readonly PendingSaid[]
  drainCommands(): readonly PendingCommand<Command>[]
}

const NOTHING_PENDING: readonly PendingEntry<never>[] = Object.freeze([])

const NOTHING_TAKEN: readonly PendingSaid[] = Object.freeze([])

const NO_COMMANDS: readonly PendingCommand<never>[] = Object.freeze([])

const NO_IMAGES: readonly SaidImage[] = Object.freeze([])

const NO_FILES: readonly SaidFile[] = Object.freeze([])

const isCommand = <Command>(entry: PendingEntry<Command>): entry is PendingCommand<Command> =>
  entry.kind === 'command'

export function createPendingQueue<Command = never>(): PendingQueue<Command> {
  let entries: readonly PendingEntry<Command>[] = NOTHING_PENDING
  let snapshot: readonly PendingEntry<Command>[] = entries
  let stamped = 0

  const listeners = new Set<() => void>()
  const reserved = new Set<string>()

  const settle = (next: readonly PendingEntry<Command>[]): void => {
    entries = next
    snapshot = entries
    for (const listener of [...listeners]) listener()
  }

  const stamp = (): string => {
    stamped += 1
    return `pending-${stamped}`
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    getSnapshot: () => snapshot,

    enqueue({ text, images, files, context, via }) {
      settle([
        ...entries,
        { kind: 'message', id: stamp(), text, images: images ?? NO_IMAGES, files: files ?? NO_FILES,
          ...(context === undefined ? {} : { context }), ...(via === undefined ? {} : { via }) },
      ])
    },

    enqueueCommand({ text, command }) {
      settle([...entries, { kind: 'command', id: stamp(), text, command }])
    },

    takeBackLast() {
      const last = [...entries].reverse().find(
        (entry) =>
          !reserved.has(entry.id) &&
          (!('via' in entry) || entry.via === undefined || entry.via === EMessageOrigin.Operator),
      )
      if (last === undefined) return null

      settle(entries.filter((entry) => entry.id !== last.id))
      if (last.kind === 'command') return { text: last.text, images: NO_IMAGES, files: NO_FILES }
      const { kind, id, ...said } = last
      return said
    },

    prepare() {
      const messages = entries.filter(
        (entry): entry is PendingMessage => entry.kind === 'message' && !reserved.has(entry.id),
      )
      for (const message of messages) reserved.add(message.id)
      let settled = false
      const release = (): void => {
        for (const message of messages) reserved.delete(message.id)
      }
      return {
        drafts: messages.flatMap((message): readonly EventDraft[] => [
          ...(message.context ?? []),
          { ...saidBody(message), ...(message.via === undefined ? {} : { via: message.via }) },
        ]),
        wakesTurn: messages.length > 0,
        acknowledge: () => {
          if (settled) return
          settled = true
          release()
          if (messages.length === 0) return
          const handed = new Set(messages.map((message) => message.id))
          settle(entries.filter((entry) => !handed.has(entry.id)))
        },
        release: () => {
          if (settled) return
          settled = true
          release()
        },
      }
    },

    drain() {
      const messages = entries.filter((entry): entry is PendingMessage => entry.kind === 'message' && !reserved.has(entry.id))
      if (messages.length === 0) return NOTHING_TAKEN

      const handed = new Set(messages.map((message) => message.id))
      settle(entries.filter((entry) => !handed.has(entry.id)))
      return messages.map(({ id, kind, ...said }) => said)
    },

    drainCommands() {
      const commands = entries.filter(isCommand)
      if (commands.length === 0) return NO_COMMANDS

      settle(entries.filter((entry) => !isCommand(entry)))
      return commands
    },
  }
}
