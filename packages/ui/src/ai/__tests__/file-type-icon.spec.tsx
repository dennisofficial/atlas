import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { artOf, EIconPart, FILE_ICON_ART, fileIconOf } from '../../file-icons'
import { FileIconsProvider, FileTypeIcon } from '../file-type-icon'
import { FileTree } from '../file-tree'

beforeAll(() => {
  GlobalRegistrator.register()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterAll(() => GlobalRegistrator.unregister())

function pathsOf(markup: string) {
  const element = document.createElement('div')
  element.innerHTML = markup
  return Array.from(element.querySelectorAll('path'))
}

describe('FileTypeIcon', () => {
  it('renders each art path in currentColor by default', () => {
    const icon = fileIconOf({ name: 'a.ts', folder: false })
    const markup = renderToStaticMarkup(<FileTypeIcon name="a.ts" className="size-3.5" />)
    const paths = pathsOf(markup)
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(
      artOf({ icon, open: false }).map((path) => path.d),
    )
    expect(paths.every((path) => path.getAttribute('fill') === 'currentColor')).toBe(true)
    expect(markup).toContain(`viewBox="${FILE_ICON_ART[icon].viewBox}"`)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('size-3.5')
  })

  it('uses the original colors inside a colored provider', () => {
    const icon = fileIconOf({ name: 'a.ts', folder: false })
    const paths = pathsOf(
      renderToStaticMarkup(
        <FileIconsProvider colored>
          <FileTypeIcon name="a.ts" />
        </FileIconsProvider>,
      ),
    )
    expect(paths.map((path) => path.getAttribute('fill'))).toEqual(
      artOf({ icon, open: false }).map((path) => path.fill ?? 'currentColor'),
    )
    expect(paths.some((path) => path.getAttribute('fill')?.startsWith('#'))).toBe(true)
    expect(paths.every((path) => !path.hasAttribute('fill-opacity'))).toBe(true)
  })

  it('keeps monochrome folder glyphs distinct from the body', () => {
    const icon = fileIconOf({ name: 'src', folder: true })
    const art = artOf({ icon, open: false })
    const paths = pathsOf(renderToStaticMarkup(<FileTypeIcon name="src" folder />))
    expect(art.some((path) => path.part === EIconPart.Body)).toBe(true)
    expect(paths.map((path) => path.getAttribute('fill-opacity'))).toEqual(
      art.map((path) => (path.part === EIconPart.Body ? '0.45' : null)),
    )
  })

  it('updates an uncontrolled folder icon when the folder opens and closes', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const icon = fileIconOf({ name: 'src', folder: true })
    const folderPaths = () =>
      Array.from(container.querySelectorAll('button svg[viewBox] path'))
        .slice(1)
        .map((path) => path.getAttribute('d'))
    try {
      await act(async () =>
        root.render(
          <FileTree nodes={[{ name: 'src', path: 'src', children: [] }]} defaultOpen={false} />,
        ),
      )
      expect(folderPaths()).toEqual(artOf({ icon, open: false }).map((path) => path.d))
      await act(async () => container.querySelector('button')?.click())
      expect(folderPaths()).toEqual(artOf({ icon, open: true }).map((path) => path.d))
      await act(async () => container.querySelector('button')?.click())
      expect(folderPaths()).toEqual(artOf({ icon, open: false }).map((path) => path.d))
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('switches to the open folder paths', () => {
    const icon = fileIconOf({ name: 'src', folder: true })
    const paths = pathsOf(renderToStaticMarkup(<FileTypeIcon name="src" folder open />))
    expect(paths.map((path) => path.getAttribute('d'))).toEqual(
      artOf({ icon, open: true }).map((path) => path.d),
    )
    expect(artOf({ icon, open: true })).not.toEqual(artOf({ icon, open: false }))
  })
})
