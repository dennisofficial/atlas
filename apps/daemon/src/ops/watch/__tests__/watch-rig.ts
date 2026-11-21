import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { CallOp, DaemonEvent, WatchChangedEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'

import { watchGroup } from '..'

export const DEBOUNCE_MS = 40

export type Rig = {
  events: DaemonEvent[]
  call(op: CallOp): Promise<unknown>
  changes(): WatchChangedEvent[]
  stop(): Promise<void>
}

export const rig = (): Rig => {
  const events: DaemonEvent[] = []
  const group = watchGroup({ publish: (event) => events.push(event) })
  const ctx: CallContext = {
    key: 'k',
    signal: new AbortController().signal,
    output: () => undefined,
    publish: () => undefined,
  }
  return {
    events,
    call: async (op) => {
      const registered = group.ops.find((candidate) => candidate.op === op.op)
      if (registered === undefined) throw new Error(`no op ${op.op}`)
      return await registered.run({ op, ctx })
    },
    changes: () =>
      events.filter((event): event is WatchChangedEvent => event.type === 'watch.changed'),
    stop: async () => {
      await group.stop?.()
    },
  }
}

export const waitUntil = async (ready: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the watcher never reported the change')
}

export const quiet = async (ms = 150): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

export const skillOf = (args: { root: string; name: string; text: string }): string =>
  join(args.root, args.name, 'SKILL.md')

export const writeSkill = async (args: {
  root: string
  name: string
  text: string
}): Promise<string> => {
  const path = skillOf(args)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, args.text)
  return path
}

export const scratchRoot = async (): Promise<string> =>
  await mkdtemp(join(tmpdir(), 'atlas-watch-'))
