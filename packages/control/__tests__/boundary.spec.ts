import { describe, expect, it } from 'bun:test'
import { Glob } from 'bun'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', 'src')

const importsOf = async (pattern: RegExp): Promise<string[]> => {
  const hits: string[] = []
  for await (const file of new Glob('**/*.ts').scan(SRC)) {
    const text = await Bun.file(join(SRC, file)).text()
    if (pattern.test(text)) hits.push(file)
  }
  return hits
}

describe('control package boundaries', () => {
  it('only src/postgres imports @dltech/atlas-db', async () => {
    const hits = await importsOf(/from ['"]@dltech\/atlas-db/)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.filter((file) => !file.startsWith('postgres/'))).toEqual([])
  })

  it('keeps the in-memory store and conformance suite off the deployable entries', async () => {
    const deployable = await importsOf(/from ['"]\.\/testing|from ['"]\.\.\/testing/)
    expect(deployable).toEqual([])
    const { InMemoryControlStore } = await import('@dltech/atlas-control/testing')
    expect(InMemoryControlStore).toBeDefined()
    expect(Object.keys(await import('@dltech/atlas-control'))).not.toContain('InMemoryControlStore')
  })

  it('imports no Nest, tRPC or HTTP stack', async () => {
    expect(await importsOf(/from ['"](@nestjs|@trpc|express|(node:)?https?)[/'"]/)).toEqual([])
  })
})
