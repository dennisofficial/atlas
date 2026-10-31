import { afterEach, describe, expect, it } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EExecutionLocation, ERunner, toThreadId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../__tests__/harness'
import { listLocalPodThreads } from '../listing-local'
import { sessionsDirectory } from '../paths'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const open = (): StoreFixture => {
  const fixture = openStoreFixture()
  fixtures.push(fixture)
  return fixture
}

describe('listing the local pod threads in a home', () => {
  it('propagates root listing errors when the sessions path is a regular file', async () => {
    const { home } = open()
    await writeFile(sessionsDirectory({ home }), 'not a directory')
    await expect(listLocalPodThreads({ home })).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('treats a missing sessions directory or missing home as an empty collection', async () => {
    const { home } = open()
    expect(await listLocalPodThreads({ home })).toEqual([])
    expect(await listLocalPodThreads({ home: join(home, 'missing-home') })).toEqual([])
  })

  it('returns every root thread on a local runner, whatever folder it came from', async () => {
    const { home, threads } = open()
    const fromTui = await threads.create({
      workspace: '/Users/dennis/atlas',
      repo: '/Users/dennis/atlas',
      executionLocation: EExecutionLocation.Cloud,
    })
    await threads.chooseRunner({ threadId: fromTui.id, runner: ERunner.Local })
    const fromMac = await threads.create({
      id: toThreadId('brn_from_mac'),
      workspace: '/workspace',
      repo: null,
      executionLocation: EExecutionLocation.Cloud,
    })
    await threads.chooseRunner({ threadId: fromMac.id, runner: ERunner.Local })
    await threads.chooseProject({ threadId: fromMac.id, projectId: 'proj_1' })

    const listed = await listLocalPodThreads({ home })

    expect(listed.map((thread) => thread.id).sort()).toEqual([fromMac.id, fromTui.id].sort())
    expect(listed.find((thread) => thread.id === fromMac.id)?.projectId).toBe('proj_1')
  })

  it('leaves out host threads, Vercel pods and spawned children', async () => {
    const { home, threads } = open()
    await threads.create({ workspace: '/w', repo: null })
    const vercel = await threads.create({ workspace: '/w', repo: null })
    await threads.chooseRunner({ threadId: vercel.id, runner: ERunner.Vercel })
    const local = await threads.create({ workspace: '/w', repo: null })
    await threads.chooseRunner({ threadId: local.id, runner: ERunner.Local })
    const child = await threads.create({
      workspace: '/w',
      repo: null,
      agent: { spawnedBy: local.id, type: 'explore' },
    })
    await threads.chooseRunner({ threadId: child.id, runner: ERunner.Local })

    const listed = await listLocalPodThreads({ home })

    expect(listed.map((thread) => thread.id)).toEqual([local.id])
  })

  it('lists newest first', async () => {
    const { home, threads } = open()
    const older = await threads.create({ workspace: '/w', repo: null })
    await threads.chooseRunner({ threadId: older.id, runner: ERunner.Local })
    const newer = await threads.create({ workspace: '/w', repo: null })
    await threads.chooseRunner({ threadId: newer.id, runner: ERunner.Local })

    const listed = await listLocalPodThreads({ home })

    expect(listed.map((thread) => thread.id)).toEqual([newer.id, older.id])
  })
})
