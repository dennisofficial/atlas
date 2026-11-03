import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PKG = join(import.meta.dir, '..')

describe('jobs package boundary', () => {
  it('depends on zod only', async () => {
    const manifest = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies)).toEqual(['zod'])
  })

  it('imports nothing outside zod', async () => {
    const hits: string[] = []
    for await (const file of new Bun.Glob('**/*.ts').scan(join(PKG, 'src'))) {
      const text = await Bun.file(join(PKG, 'src', file)).text()
      if (/from ['"](?!zod['"]|\.)/.test(text)) hits.push(file)
    }
    expect(hits).toEqual([])
  })
})
