import { describe, expect, it } from 'bun:test'

const css = await Bun.file(new URL('../../../app/desktop.css', import.meta.url)).text()

describe('desktop.css native browser frame', () => {
  it('squares the preview device on a host that paints a native view', () => {
    const rule = css.slice(css.indexOf('[data-native-browser]'))
    expect(rule).toContain('[data-slot="preview-stage-device"]')
    expect(rule).toContain('border-radius: 0')
    expect(rule).toContain('box-shadow: none')
  })
})
