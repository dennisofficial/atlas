import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Slider } from '../slider'

const thumbsOf = (html: string): number => (html.match(/data-slot="slider-thumb"/g) ?? []).length

describe('Slider', () => {
  it('renders one thumb for a scalar value', () => {
    expect(thumbsOf(renderToStaticMarkup(<Slider min={0} max={5} value={2} />))).toBe(1)
  })

  it('renders one thumb for a scalar default value', () => {
    expect(thumbsOf(renderToStaticMarkup(<Slider min={0} max={5} defaultValue={2} />))).toBe(1)
  })

  it('names the range input from the slider label', () => {
    const html = renderToStaticMarkup(<Slider aria-label="Effort" min={0} max={4} value={[2]} />)

    expect(html).toContain('aria-label="Effort"')
  })

  it('holds the glide back until the reader touches it', () => {
    const html = renderToStaticMarkup(<Slider min={0} max={4} value={[2]} />)

    expect(html).toContain('transition-[color,box-shadow]')
    expect(html).not.toContain('transition-[inset-inline-start,color,box-shadow]')
    expect(html).not.toContain('transition-[width]')
  })

  it('renders a thumb per value in a range', () => {
    expect(thumbsOf(renderToStaticMarkup(<Slider defaultValue={[20, 70]} />))).toBe(2)
  })
})
