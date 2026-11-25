import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sourceOf = (file: string): string => readFileSync(join(import.meta.dir, '..', file), 'utf8')

const dropViewBodyOf = (source: string): string => {
  const start = source.indexOf('<DragDropContentView')
  const end = source.indexOf('</DragDropContentView>')
  return source.slice(start, end)
}

describe('composer drop zone', () => {
  it('keeps the send and attach controls outside the native drop view, which swallows their taps', () => {
    const dropZone = sourceOf('composer-drop-zone.tsx')
    const body = dropViewBodyOf(dropZone)

    expect(body).toContain('{children}')
    expect(body).not.toContain('{controls}')
    expect(dropZone.indexOf('{controls}')).toBeGreaterThan(
      dropZone.indexOf('</DragDropContentView>'),
    )
  })

  it('passes the composer controls through the controls slot, not as drop view children', () => {
    const composer = sourceOf('composer.tsx')
    const children = composer.slice(
      composer.indexOf('<ComposerDropZone'),
      composer.indexOf('</ComposerDropZone>'),
    )

    expect(children).toContain('controls={controls}')
    expect(children).not.toContain('<ComposerControls')
    expect(children).not.toContain('<Button')
  })
})
