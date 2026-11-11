import { describe, expect, it } from 'bun:test'

const css = await Bun.file(new URL('../../../app/desktop.css', import.meta.url)).text()

const blockOf = (selector: string): string => {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`${selector} is missing from desktop.css`)
  return css.slice(start, css.indexOf('}', start))
}

describe('desktop.css titlebar band', () => {
  it('builds the titlebar band out of the traffic light geometry', () => {
    expect(css).toContain('--desktop-traffic-light-size: calc(var(--spacing) * 3)')
    expect(css).toContain('--desktop-traffic-light-inset: calc(var(--spacing) * 2.75)')
    expect(css).toMatch(
      /--desktop-titlebar-height: calc\(\s*var\(--desktop-traffic-light-inset\) \* 2 \+ var\(--desktop-traffic-light-size\)\s*\)/,
    )
  })

  it('centres the wordmark in that band instead of nudging it into place', () => {
    const wordmark = blockOf(
      'html[data-desktop]:not([data-fullscreen])\n  [data-slot="sidebar"]:not([data-state="collapsed"])\n  [data-desktop-wordmark] {',
    )
    expect(wordmark).toContain('height: var(--desktop-titlebar-height)')
    expect(wordmark).not.toMatch(/^\s*top:/m)
    expect(wordmark).not.toContain('position: relative')
  })

  it('hides the wordmark and its traffic light inset while the window is full screen', () => {
    const hidden = blockOf('[data-desktop-wordmark] {')
    expect(hidden).toContain('display: none')
    expect(css).not.toMatch(/html\[data-desktop\] \[data-desktop-wordmark\]/)
  })
})
