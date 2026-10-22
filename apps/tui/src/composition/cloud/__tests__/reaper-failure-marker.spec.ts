import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  clearReaperListFailureMark,
  readReaperListFailureMark,
  reaperListFailurePathFor,
  writeReaperListFailureMark,
} from '../reaper-failure-marker'

let dir: string | null = null

const sandbox = async (): Promise<string> => {
  dir = await mkdtemp(join(tmpdir(), 'reaper-marker-'))
  return dir
}

afterEach(async () => {
  if (dir === null) return
  await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('reaperListFailurePathFor', () => {
  it('names the marker file inside the atlas home', () => {
    expect(reaperListFailurePathFor('/home/me/.atlas')).toBe(
      '/home/me/.atlas/cloud-reaper-list-failure',
    )
  })
})

describe('writeReaperListFailureMark + readReaperListFailureMark', () => {
  it('round-trips the mark a boot wrote', async () => {
    const path = reaperListFailurePathFor(await sandbox())
    await writeReaperListFailureMark({
      path,
      mark: { message: 'api is unreachable', notifiedAt: 1_000 },
    })

    expect(await readReaperListFailureMark({ path })).toEqual({
      message: 'api is unreachable',
      notifiedAt: 1_000,
    })
  })

  it('is null before any boot has stamped the marker', async () => {
    const path = reaperListFailurePathFor(await sandbox())
    expect(await readReaperListFailureMark({ path })).toBeNull()
  })

  it('is null rather than throwing when the file holds garbage', async () => {
    const path = reaperListFailurePathFor(await sandbox())
    await Bun.write(path, 'this is not json')

    expect(await readReaperListFailureMark({ path })).toBeNull()
  })
})

describe('clearReaperListFailureMark', () => {
  it('removes a stamped marker', async () => {
    const path = reaperListFailurePathFor(await sandbox())
    await writeReaperListFailureMark({
      path,
      mark: { message: 'api is unreachable', notifiedAt: 1_000 },
    })

    await clearReaperListFailureMark({ path })

    expect(await readReaperListFailureMark({ path })).toBeNull()
  })

  it('does not throw when there is nothing to clear', async () => {
    const path = reaperListFailurePathFor(await sandbox())
    await expect(clearReaperListFailureMark({ path })).resolves.toBeUndefined()
  })
})
