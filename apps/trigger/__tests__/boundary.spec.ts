import { describe, expect, it } from 'bun:test'
import { Glob } from 'bun'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', 'src')

describe('trigger app boundaries', () => {
  it('src never imports apps/api or @dltech/atlas-host', async () => {
    const hits: string[] = []
    for await (const file of new Glob('**/*.ts').scan(SRC)) {
      const text = await Bun.file(join(SRC, file)).text()
      if (/from ['"](?:.*apps\/api|@dltech\/atlas-host)/.test(text)) hits.push(file)
    }
    expect(hits).toEqual([])
  })
})
