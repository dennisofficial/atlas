import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  claimReleaseNotesLaunch,
  launchedVersionsPathFor,
  LEGACY_LAST_LAUNCHED_FILENAME,
  newestLaunchedVersion,
} from '../launched-version'

let home = ''

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'atlas-launched-version-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('claimReleaseNotesLaunch', () => {
  it('records the first run silently and then sees it as unchanged', async () => {
    expect(await claimReleaseNotesLaunch({ home, version: '1.32.1' })).toEqual({ kind: 'first-run' })
    expect(await newestLaunchedVersion({ home })).toBe('1.32.1')
    expect(await claimReleaseNotesLaunch({ home, version: '1.32.1' })).toEqual({ kind: 'unchanged' })
  })

  it('reports the range once when the version moves forward', async () => {
    await claimReleaseNotesLaunch({ home, version: '1.28.0' })

    expect(await claimReleaseNotesLaunch({ home, version: '1.32.1' })).toEqual({
      kind: 'changed',
      from: '1.28.0',
      to: '1.32.1',
    })
    expect(await claimReleaseNotesLaunch({ home, version: '1.32.1' })).toEqual({ kind: 'unchanged' })
  })

  it('never lowers the recorded version on a downgrade, so the next upgrade is silent', async () => {
    await claimReleaseNotesLaunch({ home, version: '1.33.0' })

    expect(await claimReleaseNotesLaunch({ home, version: '1.32.1' })).toEqual({ kind: 'unchanged' })
    expect(await newestLaunchedVersion({ home })).toBe('1.33.0')
    expect(await claimReleaseNotesLaunch({ home, version: '1.33.0' })).toEqual({ kind: 'unchanged' })
  })

  it('continues from the single-version file older builds wrote', async () => {
    await writeFile(join(home, LEGACY_LAST_LAUNCHED_FILENAME), '1.30.0\n')

    expect(await claimReleaseNotesLaunch({ home, version: '1.32.1' })).toEqual({
      kind: 'changed',
      from: '1.30.0',
      to: '1.32.1',
    })
  })

  it('keeps the newest version when an older build rewrites the legacy file', async () => {
    await claimReleaseNotesLaunch({ home, version: '1.33.0' })
    await writeFile(join(home, LEGACY_LAST_LAUNCHED_FILENAME), '1.20.0\n')

    expect(await newestLaunchedVersion({ home })).toBe('1.33.0')
  })

  it('adopts a current legacy file as a marker so an older build rewriting it cannot replay the notes', async () => {
    const legacy = join(home, LEGACY_LAST_LAUNCHED_FILENAME)
    await writeFile(legacy, '1.41.0\n')

    expect(await claimReleaseNotesLaunch({ home, version: '1.41.0' })).toEqual({ kind: 'unchanged' })
    await writeFile(legacy, '1.40.0\n')

    expect(await claimReleaseNotesLaunch({ home, version: '1.41.0' })).toEqual({ kind: 'unchanged' })
    expect(await newestLaunchedVersion({ home })).toBe('1.41.0')
  })

  it('adopts a newer legacy file on a downgrade launch', async () => {
    const legacy = join(home, LEGACY_LAST_LAUNCHED_FILENAME)
    await writeFile(legacy, '1.41.0\n')

    expect(await claimReleaseNotesLaunch({ home, version: '1.40.0' })).toEqual({ kind: 'unchanged' })
    await writeFile(legacy, '1.39.0\n')

    expect(await claimReleaseNotesLaunch({ home, version: '1.41.0' })).toEqual({ kind: 'unchanged' })
  })

  it('ignores unparseable marker names and an unparseable current version', async () => {
    await mkdir(launchedVersionsPathFor({ home }), { recursive: true })
    await writeFile(join(launchedVersionsPathFor({ home }), 'garbage'), '')

    expect(await newestLaunchedVersion({ home })).toBeNull()
    expect(await claimReleaseNotesLaunch({ home, version: 'not-a-version' })).toEqual({ kind: 'first-run' })
    expect(await readdir(launchedVersionsPathFor({ home }))).toEqual(['garbage'])
  })

  it('treats an unwritable home as unchanged rather than failing the launch', async () => {
    const blocked = join(home, 'blocked')
    await writeFile(blocked, 'a file where the home directory should be')

    expect(await claimReleaseNotesLaunch({ home: blocked, version: '1.32.1' })).toEqual({ kind: 'unchanged' })
  })
})

describe('concurrent clients on one real filesystem', () => {
  it('hands the notes to exactly one of many clients launching the same new version', async () => {
    await claimReleaseNotesLaunch({ home, version: '1.28.0' })

    const decisions = await Promise.all(
      Array.from({ length: 24 }, () => claimReleaseNotesLaunch({ home, version: '1.32.1' })),
    )

    expect(decisions.filter((decision) => decision.kind === 'changed')).toHaveLength(1)
    expect(await newestLaunchedVersion({ home })).toBe('1.32.1')
  })

  it('settles on the highest version whatever order mixed-version clients land in', async () => {
    const versions = ['1.31.0', '1.34.0', '1.32.0', '1.33.1', '1.30.0', '1.34.0', '1.29.5']

    await Promise.all(versions.map((version) => claimReleaseNotesLaunch({ home, version })))

    expect(await newestLaunchedVersion({ home })).toBe('1.34.0')
    expect(await claimReleaseNotesLaunch({ home, version: '1.33.1' })).toEqual({ kind: 'unchanged' })
  })

  it('does not let a slow older client lower what a newer one already recorded', async () => {
    const older = claimReleaseNotesLaunch({ home, version: '1.31.0' })
    const newer = claimReleaseNotesLaunch({ home, version: '1.33.0' })
    await Promise.all([older, newer])
    await claimReleaseNotesLaunch({ home, version: '1.31.0' })

    expect(await newestLaunchedVersion({ home })).toBe('1.33.0')
  })
})
