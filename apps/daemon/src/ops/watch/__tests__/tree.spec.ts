import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { guardedWatch } from '../tree'
import { DEBOUNCE_MS, quiet, rig, scratchRoot, waitUntil } from './watch-rig'

describe('the daemon tree watch', () => {
  it('reports a file in a directory created after start, at any depth', async () => {
    const root = await scratchRoot()
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await mkdir(join(root, 'a', 'b'), { recursive: true })
      await quiet()
      const path = join(root, 'a', 'b', 'file.ts')
      await writeFile(path, 'x')
      await waitUntil(() => watch.changes().some((change) => change.paths.includes(path)))
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not watch inside node_modules', async () => {
    const root = await scratchRoot()
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    const watch = rig()
    try {
      await watch.call({ op: 'watch.start', watchId: 'w1', roots: [root], debounceMs: DEBOUNCE_MS })
      await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x')
      await quiet()
      expect(watch.changes()).toHaveLength(0)
      const path = join(root, 'src.ts')
      await writeFile(path, 'x')
      await waitUntil(() => watch.changes().length > 0)
      expect(watch.changes().flatMap((change) => change.paths)).toEqual([path])
    } finally {
      await watch.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('hands a watcher error to onError instead of throwing it', async () => {
    const root = await scratchRoot()
    const errors: unknown[] = []
    try {
      const watcher = guardedWatch({
        path: root,
        recursive: false,
        onEvent: () => undefined,
        onError: (error) => errors.push(error),
      })
      watcher?.emit('error', new Error('ENOSPC: no space left on device, watch'))
      expect(errors).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a watch that cannot start instead of throwing', () => {
    const errors: unknown[] = []
    const watcher = guardedWatch({
      path: '/nonexistent/atlas-watch-root',
      recursive: false,
      onEvent: () => undefined,
      onError: (error) => errors.push(error),
    })
    expect(watcher).toBeNull()
    expect(errors).toHaveLength(1)
  })
})
