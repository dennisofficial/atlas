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

describe('host package boundaries', () => {
  it('imports no harness, Nest, tRPC or app code from src', async () => {
    expect(
      await importsOf(/from ['"](@dltech\/atlas-harness|@dltech\/atlas-ui|@nestjs|@trpc)/),
    ).toEqual([])
  })

  it('keeps the shared suite on the testing export only', async () => {
    const { describeRemoteCalls } = await import('@dltech/atlas-host/testing')
    expect(describeRemoteCalls).toBeDefined()
    expect(Object.keys(await import('@dltech/atlas-host'))).not.toContain('describeRemoteCalls')
  })
})
