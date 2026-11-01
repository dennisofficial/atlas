import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ActivityFileLockUnavailableError, withActivityFileLock } from '../file-lock'

let directory: string
let path: string
const children: Bun.Subprocess<'pipe', 'pipe', 'pipe'>[] = []

async function holdInChild() {
  const source = `
    import { withActivityFileLock } from ${JSON.stringify(new URL('../file-lock.ts', import.meta.url).href)}
    await withActivityFileLock({
      path: ${JSON.stringify(path)},
      run: async () => { console.log('entered'); await Bun.stdin.text() },
    })
    console.log('released')
  `
  const child = Bun.spawn({
    cmd: [process.execPath, '--eval', source],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  children.push(child)
  const reader = child.stdout.getReader()
  let ready = ''
  while (!ready.includes('\n')) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error('Lock holder exited before entering')
    ready += new TextDecoder().decode(chunk.value)
  }
  reader.releaseLock()
  expect(ready).toBe('entered\n')
  return child
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-activity-lock-'))
  path = join(directory, 'thread.activity.lock')
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill()
    await child.exited
  }
  await readdir(directory)
  await rm(directory, { recursive: true, force: true })
})

describe('withActivityFileLock', () => {
  it('reports filesystem acquisition errors without running the callback', async () => {
    let called = false
    await expect(
      withActivityFileLock({
        path: join(directory, 'missing', 'thread.activity.lock'),
        run: () => {
          called = true
        },
      }),
    ).rejects.toBeInstanceOf(ActivityFileLockUnavailableError)
    expect(called).toBe(false)
    expect(await readdir(directory)).toEqual([])
  })

  it('waits for a separate process to finish before entering', async () => {
    const child = await holdInChild()
    const foreign = await readFile(path, 'utf8')
    await expect(
      withActivityFileLock({ path, timeoutMs: 30, run: () => 'must not enter' }),
    ).rejects.toBeInstanceOf(ActivityFileLockUnavailableError)
    expect(await readFile(path, 'utf8')).toBe(foreign)
    const timer = setTimeout(() => child.stdin.end(), 60)
    let owned = ''
    try {
      await withActivityFileLock({
        path,
        run: async () => {
          owned = await readFile(path, 'utf8')
        },
      })
    } finally {
      clearTimeout(timer)
    }
    expect(owned).not.toBe(foreign)
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stderr).text()).toBe('')
    expect(await readdir(directory)).toEqual([])
  })

  it.each([undefined, 60_000])(
    'leaves orphaned claims untouched with a maximum two-second budget: %s',
    async (timeoutMs) => {
      const child = await holdInChild()
      const foreign = await readFile(path, 'utf8')
      child.kill()
      await child.exited
      let called = false
      const started = performance.now()
      await expect(
        withActivityFileLock({
          path,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          run: () => {
            called = true
          },
        }),
      ).rejects.toBeInstanceOf(ActivityFileLockUnavailableError)
      expect(performance.now() - started).toBeGreaterThanOrEqual(1_900)
      expect(performance.now() - started).toBeLessThan(3_000)
      expect(called).toBe(false)
      expect(await readFile(path, 'utf8')).toBe(foreign)
    },
  )

  it('bounds local queue waiting, keeps other paths independent, and never limits callback execution', async () => {
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const owner = withActivityFileLock({
      path,
      timeoutMs: 20,
      run: async () => {
        entered.resolve()
        await finish.promise
        return 'owner'
      },
    })
    await entered.promise
    let called = false
    const started = performance.now()
    try {
      await expect(
        withActivityFileLock({
          path,
          timeoutMs: 40,
          run: () => {
            called = true
          },
        }),
      ).rejects.toBeInstanceOf(ActivityFileLockUnavailableError)
      expect(performance.now() - started).toBeLessThan(500)
      expect(
        await withActivityFileLock({ path: join(directory, 'other.lock'), run: () => 7 }),
      ).toBe(7)
    } finally {
      finish.resolve()
      expect(await owner).toBe('owner')
    }
    expect(called).toBe(false)
    expect(await withActivityFileLock({ path, run: () => 'next caller' })).toBe('next caller')
    expect(await readdir(directory)).toEqual([])
  })

  it('does not unlink a replacement file even if it copies the original claim', async () => {
    let contents = ''
    await expect(
      withActivityFileLock({
        path,
        run: async () => {
          contents = await readFile(path, 'utf8')
          await rename(path, `${path}.original`)
          await writeFile(path, contents)
        },
      }),
    ).rejects.toBeInstanceOf(ActivityFileLockUnavailableError)
    expect(await readFile(path, 'utf8')).toBe(contents)
  })

  it.each([JSON.stringify({ token: 'another-claim', pid: process.pid }), '{malformed replacement'])(
    'refuses to unlink a foreign or malformed replacement: %s',
    async (foreign) => {
      await expect(
        withActivityFileLock({
          path,
          run: () => writeFile(path, foreign),
        }),
      ).rejects.toBeInstanceOf(ActivityFileLockUnavailableError)
      expect(await readFile(path, 'utf8')).toBe(foreign)
    },
  )

  it('times out on an unverifiable claim without running or deleting it', async () => {
    const foreign = '{malformed claim'
    await writeFile(path, foreign)
    let called = false
    const started = performance.now()
    await expect(
      withActivityFileLock({
        path,
        timeoutMs: 40,
        run: () => {
          called = true
        },
      }),
    ).rejects.toThrow('Timed out acquiring activity file lock')
    expect(performance.now() - started).toBeGreaterThanOrEqual(30)
    expect(performance.now() - started).toBeLessThan(500)
    expect(called).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(foreign)
  })

  it('serializes independent callers for the same path without a same-PID bypass', async () => {
    const order: string[] = []
    const results = await Promise.allSettled([
      withActivityFileLock({
        path,
        run: async () => {
          order.push('first entered')
          await Bun.sleep(40)
          order.push('first left')
        },
      }),
      withActivityFileLock({
        path: `${directory}/./thread.activity.lock`,
        run: () => {
          order.push('second entered')
        },
      }),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(order).toEqual(['first entered', 'first left', 'second entered'])
  })

  it('releases the claim after a callback throws and preserves the original error', async () => {
    const failure = new Error('persistence failed')
    await expect(
      withActivityFileLock({
        path,
        run: () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(await readdir(directory)).toEqual([])
    expect(await withActivityFileLock({ path, run: () => 'retry succeeded' })).toBe(
      'retry succeeded',
    )
  })

  it('holds a unique exclusive claim for the callback and releases before returning its value', async () => {
    const claims: string[] = []
    for (let index = 0; index < 2; index += 1) {
      const result = await withActivityFileLock({
        path,
        run: async () => {
          const contents = await readFile(path, 'utf8')
          const claim = JSON.parse(contents)
          expect(claim.pid).toBe(process.pid)
          expect(claim.token).toBeString()
          expect(claim.token.length).toBeGreaterThan(0)
          claims.push(claim.token)
          return { persisted: true }
        },
      })
      expect(result).toEqual({ persisted: true })
      expect(await readdir(directory)).toEqual([])
    }
    expect(claims[0]).not.toBe(claims[1])
  })
})
