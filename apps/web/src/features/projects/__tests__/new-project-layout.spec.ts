import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import { chromeOverridesIn } from '@dltech/atlas-ui/lib/chrome-overrides'

const APPS = resolve(import.meta.dir, '../../../../..')

for (const app of ['web', 'prototype']) {
  const directory = resolve(APPS, app, 'src/features/projects')
  const read = (file: string) => Bun.file(resolve(directory, file)).text()

  describe(`${app} creation layout`, () => {
    it('bounds the dialog, scrolls only the body, and keeps navigation grouped', async () => {
      const source = await read('new-project-dialog.tsx')
      expect(source).toContain('max-h-[calc(100dvh-2rem)]')
      expect(source).toContain('flex-col overflow-hidden')
      expect(source.match(/overflow-y-auto/g)).toHaveLength(1)
      expect(source).toContain('min-h-0 overflow-y-auto')
      expect(source).not.toContain('min-h-64')
      expect(source).not.toContain('100dvh-14rem')
      expect(source).toContain('DialogHeader className="shrink-0"')
      expect(source).toContain('grid shrink-0 grid-cols-[1fr_auto]')
      expect(source).toContain('col-span-2 flex justify-end gap-2 sm:col-span-1')
    })

    it('stacks secret fields on phones without shrinking editable text', async () => {
      const source = await read('new-project-secrets-editor.tsx')
      expect(source).toContain('sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]')
      expect(source).toContain('col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1')
      expect(source).toContain('col-start-2 row-start-1 sm:col-start-3')
      expect(source).toContain('font-mono md:text-xs')
      expect(source).not.toContain('font-mono text-xs')
    })

    it('keeps recent repositories readable on narrow screens', async () => {
      const source = await read('new-project-repository-step.tsx')
      expect(source).toContain('grid grid-cols-1 gap-2 sm:grid-cols-2')
      expect(source).toContain('<li key={repo.fullName} className="min-w-0">')
    })

    it('does not override design-system chrome in creation components', async () => {
      for (const file of [
        'new-project-dialog.tsx',
        'new-project-secrets-editor.tsx',
        'new-project-repository-step.tsx',
      ]) {
        expect(
          chromeOverridesIn({
            source: await read(file),
            fileName: file,
            componentSpecifiers: [/^@dltech\/atlas-ui\/components\//],
          }),
        ).toEqual([])
      }
    })
  })
}
