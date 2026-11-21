import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { DEBOUNCE_MS, rig, waitUntil, quiet, writeSkill, scratchRoot } from './watch-rig'

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

  it('counts one seq per debounced batch', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await mkdir(root, { recursive: true })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      const before = await watch.call({ op: 'watch.status', watchIds: ['w1'] })
      expect(before).toMatchObject({ watches: [{ watchId: 'w1', seq: 0 }] })
      await writeSkill({ root, name: 'alpha', text: 'a' })
      await writeSkill({ root, name: 'beta', text: 'b' })
      await waitUntil(() => watch.changes().length > 0)
      await quiet()
      expect(await watch.call({ op: 'watch.status', watchIds: ['w1'] })).toMatchObject({
        watches: [{ watchId: 'w1', seq: 1 }],
      })
      await writeSkill({ root, name: 'gamma', text: 'c' })
      await waitUntil(() => watch.changes().length > 1)
      expect(await watch.call({ op: 'watch.status', watchIds: ['w1'] })).toMatchObject({
        watches: [{ watchId: 'w1', seq: 2 }],
      })
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('ignores files whose basename the watch does not name', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await mkdir(root, { recursive: true })
    const watch = rig()
    try {
      await watch.call({
        op: 'watch.start',
        watchId: 'w1',
        roots: [root],
        basenames: ['SKILL.md'],
        debounceMs: DEBOUNCE_MS,
      })
      await writeFile(join(root, 'notes.txt'), 'ignored')
      await quiet(200)
      expect(watch.changes()).toHaveLength(0)
      expect(await watch.call({ op: 'watch.status', watchIds: ['w1'] })).toMatchObject({
        watches: [{ watchId: 'w1', seq: 0 }],
      })
      await writeSkill({ root, name: 'alpha', text: 'a' })
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes()[0]?.paths.some((path) => path.endsWith('SKILL.md'))).toBe(true)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('arms a root created after start and reports its children', async () => {
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
      await mkdir(root, { recursive: true })
      await waitUntil(() => watch.changes().length > 0)
      const path = await writeSkill({ root, name: 'beta', text: 'b' })
      await waitUntil(() => watch.changes().length > 1)
      expect(watch.changes()[1]?.paths).toContain(path)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('reports one instance per group and omits unknown ids', async () => {
    const base = await scratchRoot()
    const root = join(base, 'skills')
    await mkdir(root, { recursive: true })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await watch.call({ op: 'watch.start', watchId: 'w2', roots: [root], debounceMs: DEBOUNCE_MS })
      const first = (await watch.call({ op: 'watch.status', watchIds: ['w1', 'absent'] })) as {
        instance: string
        watches: { watchId: string }[]
      }
      const second = (await watch.call({ op: 'watch.status', watchIds: ['w1', 'w2'] })) as {
        instance: string
        watches: { watchId: string }[]
      }
      expect(first.instance).toBe(second.instance)
      expect(first.watches.map((entry) => entry.watchId)).toEqual(['w1'])
      expect(second.watches.map((entry) => entry.watchId)).toEqual(['w1', 'w2'])
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
