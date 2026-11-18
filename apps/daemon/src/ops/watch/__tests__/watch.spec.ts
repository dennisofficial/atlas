import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { CallOp, DaemonEvent, WatchChangedEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'
import { describe, expect, it } from 'bun:test'

import { watchGroup } from '..'

const DEBOUNCE_MS = 40

type Rig = {
  events: DaemonEvent[]
  call(op: CallOp): Promise<unknown>
  changes(): WatchChangedEvent[]
  stop(): Promise<void>
}

const rig = (): Rig => {
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

const waitUntil = async (ready: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the watcher never reported the change')
}

const quiet = async (ms = 150): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const skillOf = (args: { root: string; name: string; text: string }): string =>
  join(args.root, args.name, 'SKILL.md')

const writeSkill = async (args: { root: string; name: string; text: string }): Promise<string> => {
  const path = skillOf(args)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, args.text)
  return path
}

const scratchRoot = async (): Promise<string> => await mkdtemp(join(tmpdir(), 'atlas-watch-'))

describe('the daemon watch op', () => {
  it('reports a new SKILL.md under a watched root', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await mkdir(root, { recursive: true })
    const watch = rig()
    try {
      const armed = await watch.call({
        op: 'watch.start',
        watchId: 'w1',
        roots: [root],
        debounceMs: DEBOUNCE_MS,
      })
      expect(armed).toEqual([root])
      const path = await writeSkill({ root, name: 'alpha', text: 'a' })
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes()[0]?.watchId).toBe('w1')
      expect(watch.changes()[0]?.paths).toContain(path)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('coalesces a burst of writes into one change', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await mkdir(root, { recursive: true })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await writeSkill({ root, name: 'alpha', text: 'a' })
      await writeSkill({ root, name: 'beta', text: 'b' })
      await writeSkill({ root, name: 'gamma', text: 'c' })
      await waitUntil(() => watch.changes().length > 0)
      await quiet()
      expect(watch.changes()).toHaveLength(1)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('reports an edit of a SKILL.md already on disk', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    const path = await writeSkill({ root, name: 'alpha', text: 'a' })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await writeFile(path, 'edited')
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes()[0]?.paths).toContain(path)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('reports a removed skill directory', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await writeSkill({ root, name: 'alpha', text: 'a' })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await rm(join(root, 'alpha'), { recursive: true, force: true })
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes()[0]?.paths.some((path) => path.includes('alpha'))).toBe(true)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('follows a root that is a symlink', async () => {
    const base = await scratchRoot()
    const real = join(base, 'real-skills')
    await mkdir(real, { recursive: true })
    const root = join(base, 'skills')
    await symlink(real, root)
    const watch = rig()
    try {
      const armed = await watch.call({
        op: 'watch.start',
        watchId: 'w1',
        roots: [root],
        debounceMs: DEBOUNCE_MS,
      })
      expect(armed).toEqual([real])
      await writeSkill({ root: real, name: 'alpha', text: 'a' })
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes()[0]?.paths[0]).toContain(join(real, 'alpha'))
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('arms a root that does not exist yet and reports its creation', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    const watch = rig()
    try {
      const armed = await watch.call({
        op: 'watch.start',
        watchId: 'w1',
        roots: [root],
        debounceMs: DEBOUNCE_MS,
      })
      expect(armed).toEqual([])
      await writeSkill({ root, name: 'alpha', text: 'a' })
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes()[0]?.paths.some((path) => path.includes('skills'))).toBe(true)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('stays quiet after watch.stop', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await mkdir(root, { recursive: true })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await watch.call({ op: 'watch.stop', watchId: 'w1' })
      await writeSkill({ root, name: 'alpha', text: 'a' })
      await quiet(200)
      expect(watch.changes()).toHaveLength(0)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })
})
