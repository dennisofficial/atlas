import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const roots = [
  join(import.meta.dir, '..'),
  join(import.meta.dir, '../../../../packages/ui-native/src'),
]

const sourcesUsing = (name: string): string[] =>
  roots.flatMap((root) =>
    [...new Bun.Glob('**/*.tsx').scanSync({ cwd: root })]
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => readFileSync(join(root, file), 'utf8').includes(name))
      .map((file) => join(root, file)),
  )

describe('loading spinner', () => {
  it('uses the Atlas Spinner, never the iOS ActivityIndicator', () => {
    expect(sourcesUsing('ActivityIndicator')).toEqual([])
  })
})
