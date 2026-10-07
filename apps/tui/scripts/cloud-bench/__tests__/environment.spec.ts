import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertBenchmarkOutput, seedBenchmarkHome } from '../environment'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-bench-environment-'))
  roots.push(root)
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  await mkdir(source)
  await mkdir(destination)
  return { root, source, destination }
}

describe('benchmark environment isolation', () => {
  it('rejects output inside a source, including aliases, before creating it', async () => {
    const { root, source } = await fixture()
    const alias = join(root, 'alias')
    await symlink(source, alias)
    await expect(
      assertBenchmarkOutput({
        output: join(alias, 'new', 'scratch'),
        protectedRoots: [source],
      }),
    ).rejects.toThrow('protected source')
    await expect(
      assertBenchmarkOutput({ output: source, protectedRoots: [source] }),
    ).rejects.toThrow('protected source')
  })

  it('permits an independent private output directory', async () => {
    const { source, destination } = await fixture()
    await assertBenchmarkOutput({
      output: join(destination, 'new', 'scratch'),
      protectedRoots: [source],
    })
  })

  it('copies credential seeds without cloud sign-in or changing the source', async () => {
    const { source, destination } = await fixture()
    await writeFile(join(source, 'key'), 'fixture-key')
    await writeFile(join(source, 'auth.json'), '{"fixture":"encrypted"}')
    await writeFile(join(source, 'cloud.json'), 'must stay local')
    const home = await seedBenchmarkHome({
      sourceHome: source,
      directory: destination,
    })
    expect(await readFile(join(home, 'key'), 'utf8')).toBe('fixture-key')
    expect(await readFile(join(source, 'auth.json'), 'utf8')).toBe('{"fixture":"encrypted"}')
    await expect(readFile(join(home, 'cloud.json'))).rejects.toThrow()
    await expect(
      seedBenchmarkHome({ sourceHome: source, directory: destination }),
    ).rejects.toThrow()
  })
})
