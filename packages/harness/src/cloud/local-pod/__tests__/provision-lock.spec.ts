import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileProvisionLock } from '../provision-lock'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-lock-spec-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('fileProvisionLock', () => {
  it('runs two concurrent calls for one name one after the other', async () => {
    const lock = fileProvisionLock({ directory, pollMs: 5 })
    const events: string[] = []

    const run = (label: string) =>
      lock({
        name: 'atlas-pod-a',
        run: async () => {
          events.push(`${label}:start`)
          await Bun.sleep(40)
          events.push(`${label}:end`)
          return label
        },
      })

    const results = await Promise.all([run('first'), run('second')])

    expect(results).toEqual(['first', 'second'])
    const [leader] = (events[0] ?? '').split(':')
    const follower = leader === 'first' ? 'second' : 'first'
    expect(events).toEqual([`${leader}:start`, `${leader}:end`, `${follower}:start`, `${follower}:end`])
  })

  it('does not serialize different names', async () => {
    const lock = fileProvisionLock({ directory, pollMs: 5 })
    let inside = 0
    let peak = 0
    const run = (name: string) =>
      lock({
        name,
        run: async () => {
          inside += 1
          peak = Math.max(peak, inside)
          await Bun.sleep(30)
          inside -= 1
        },
      })

    await Promise.all([run('atlas-pod-a'), run('atlas-pod-b')])

    expect(peak).toBe(2)
  })

  it('takes over a lock whose holder pid is dead', async () => {
    await writeFile(join(directory, 'atlas-pod-a.lock'), '424242')
    const checked: number[] = []
    const lock = fileProvisionLock({
      directory,
      pollMs: 5,
      staleCheck: (pid) => {
        checked.push(pid)
        return true
      },
    })

    const result = await lock({ name: 'atlas-pod-a', run: async () => 'ran' })

    expect(result).toBe('ran')
    expect(checked).toEqual([424242])
  })

  it('releases the lock when the run throws', async () => {
    const lock = fileProvisionLock({ directory, pollMs: 5 })
    const original = new Error('provision failed')

    const failure = await lock({
      name: 'atlas-pod-a',
      run: async () => {
        throw original
      },
    }).catch((error: unknown) => error)

    expect(failure).toBe(original)
    expect(await readdir(directory)).toEqual([])
    expect(await lock({ name: 'atlas-pod-a', run: async () => 'again' })).toBe('again')
  })

  it('gives up with the holder pid once the deadline passes', async () => {
    await writeFile(join(directory, 'atlas-pod-a.lock'), '424242')
    const lock = fileProvisionLock({ directory, pollMs: 5, deadlineMs: 40, staleCheck: () => false })

    const failure = await lock({ name: 'atlas-pod-a', run: async () => 'never' }).catch((error: unknown) => error)

    expect((failure as Error).message).toContain('pod atlas-pod-a is being provisioned by process 424242')
    expect((failure as Error).message).toContain('gave up waiting after')
    expect(await readdir(directory)).toEqual(['atlas-pod-a.lock'])
  })

  it('leaves a lock alone that another holder re-took while we were releasing', async () => {
    const lock = fileProvisionLock({ directory, pollMs: 5 })
    const path = join(directory, 'atlas-pod-a.lock')

    await lock({
      name: 'atlas-pod-a',
      run: async () => {
        await writeFile(path, '999999')
      },
    })

    expect(await readdir(directory)).toEqual(['atlas-pod-a.lock'])
  })
})
