import { describe, expect, it } from 'bun:test'

import { readLastLaunched, writeLastLaunched } from '../last-launched'

const tempPath = async (): Promise<string> => {
  const dir = await Bun.$`mktemp -d`.text()
  return `${dir.trim()}/last-launched`
}

describe('last-launched state', () => {
  it('reads null when no file exists', async () => {
    expect(await readLastLaunched(await tempPath())).toBeNull()
  })

  it('round-trips a version', async () => {
    const path = await tempPath()
    await writeLastLaunched({ path, version: '1.32.1' })
    expect(await readLastLaunched(path)).toBe('1.32.1')
  })

  it('overwrites an older version', async () => {
    const path = await tempPath()
    await writeLastLaunched({ path, version: '1.28.0' })
    await writeLastLaunched({ path, version: '1.32.1' })
    expect(await readLastLaunched(path)).toBe('1.32.1')
  })

  it('reads null when the file holds garbage', async () => {
    const path = await tempPath()
    await Bun.write(path, 'not-a-version\n')
    expect(await readLastLaunched(path)).toBeNull()
  })

  it('refuses to write an unparseable version', async () => {
    const path = await tempPath()
    await writeLastLaunched({ path, version: 'garbage' })
    expect(await readLastLaunched(path)).toBeNull()
  })
})
