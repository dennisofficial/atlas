import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'bun:test'

import { walkTree } from '../index'

import { removeTempDirs, tempDir, writePath } from './temp'

afterAll(removeTempDirs)

const fixture = (): string => {
  const root = tempDir()
  writePath({ root, path: 'index.html', contents: '<html></html>' })
  writePath({ root, path: 'src/app.js', contents: 'console.log(1)' })
  writePath({ root, path: 'src/lib/util.js', contents: 'export const a = 1' })
  writePath({ root, path: 'node_modules/left-pad/index.js', contents: 'module.exports = 1' })
  return root
}

const collect = async (args: Parameters<typeof walkTree>[0]): Promise<string[]> => {
  const paths: string[] = []
  for await (const file of walkTree(args)) paths.push(file.path)
  return paths.sort()
}

describe('walkTree', () => {
  it('yields every file with a relative path, absolute path and size', async () => {
    const root = fixture()
    const walked = []
    for await (const file of walkTree({ root })) walked.push(file)
    expect(walked.map((file) => file.path).sort()).toEqual([
      'index.html',
      'src/app.js',
      'src/lib/util.js',
    ])
    const html = walked.find((file) => file.path === 'index.html')
    expect(html?.absolute).toBe(join(root, 'index.html'))
    expect(html?.size).toBe('<html></html>'.length)
  })

  it('filters files', async () => {
    const root = fixture()
    expect(await collect({ root, filter: (path) => path.endsWith('.js') })).toEqual([
      'src/app.js',
      'src/lib/util.js',
    ])
  })

  it('skips hard-excluded directories without offering their files to the filter', async () => {
    const root = fixture()
    const visited: string[] = []
    const paths = await collect({
      root,
      filter: (path) => {
        visited.push(path)
        return true
      },
    })
    expect(paths).toEqual(['index.html', 'src/app.js', 'src/lib/util.js'])
    expect(visited).not.toContain('node_modules/left-pad/index.js')
  })

  it('does not descend into symlinks', async () => {
    const root = fixture()
    Bun.spawnSync(['ln', '-s', join(root, 'src'), join(root, 'linked')])
    expect(await collect({ root })).not.toContain('linked/app.js')
  })
})
