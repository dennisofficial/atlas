import { Glob } from 'bun'
import { describe, expect, it } from 'bun:test'

const WIRE_ROOT_IMPORT = /from ['"]@dltech\/atlas-wire['"]/

describe('web imports of @dltech/atlas-wire', () => {
  it('only reach the browser-safe /web subpath, never the root that pulls in @vercel/sandbox', async () => {
    const offenders: string[] = []
    for await (const path of new Glob('src/**/*.{ts,tsx}').scan({ cwd: `${import.meta.dir}/..` })) {
      const source = await Bun.file(`${import.meta.dir}/../${path}`).text()
      if (WIRE_ROOT_IMPORT.test(source)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })
})
