import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { isDragRegionTarget } from '../drag-target'
import { handleDocumentDoubleClick, TITLEBAR_DOUBLE_CLICK_PATH } from '../titlebar-double-click'

beforeAll(() => {
  GlobalRegistrator.register()
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('isDragRegionTarget', () => {
  it('accepts the header, its plain children and the empty-state logo', () => {
    document.documentElement.setAttribute('data-desktop', '')
    const body = mount(
      '<header data-chrome="titlebar"><h1 id="t">x</h1></header><svg id="logo" data-desktop-drag=""></svg>',
    )
    expect(isDragRegionTarget(body.querySelector('#t'))).toBe(true)
    expect(isDragRegionTarget(body.querySelector('#logo'))).toBe(true)
    expect(isDragRegionTarget(body.querySelector('header'))).toBe(true)
  })

  it('keeps the scrolling sidebar list out of the drag region', () => {
    document.documentElement.setAttribute('data-desktop', '')
    const body = mount(
      '<div data-slot="sidebar-inner"><div data-slot="sidebar-header" id="h"></div><div data-slot="sidebar-content"><div id="row" class="hover:bg-sidebar-accent"><span id="rule"></span></div></div></div>',
    )
    expect(isDragRegionTarget(body.querySelector('#h'))).toBe(true)
    expect(isDragRegionTarget(body.querySelector('#row'))).toBe(false)
    expect(isDragRegionTarget(body.querySelector('#rule'))).toBe(false)
  })

  it('rejects interactive descendants and non-drag content', () => {
    document.documentElement.setAttribute('data-desktop', '')
    const body = mount(
      '<header data-chrome="titlebar"><button id="b"><span id="s">y</span></button></header><main id="m"></main>',
    )
    expect(isDragRegionTarget(body.querySelector('#s'))).toBe(false)
    expect(isDragRegionTarget(body.querySelector('#b'))).toBe(false)
    expect(isDragRegionTarget(body.querySelector('#m'))).toBe(false)
    expect(isDragRegionTarget(null)).toBe(false)
  })
})

describe('handleDocumentDoubleClick', () => {
  it('posts only for drag targets', () => {
    document.documentElement.setAttribute('data-desktop', '')
    const body = mount(
      '<header data-chrome="titlebar"><h1 id="t"></h1></header><main id="m"></main>',
    )
    const posted: string[] = []
    const post = (path: string) => void posted.push(path)
    handleDocumentDoubleClick({ event: { target: body.querySelector('#m') }, post })
    handleDocumentDoubleClick({ event: { target: body.querySelector('#t') }, post })
    expect(posted).toEqual([TITLEBAR_DOUBLE_CLICK_PATH])
  })
})
