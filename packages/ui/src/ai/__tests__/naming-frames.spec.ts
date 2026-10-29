import { describe, expect, it } from 'bun:test'

import { NAMING_NOISE, noiseLine, streamingLine } from '../naming-frames'

const first = (): number => 0
const last = (): number => 0.999

describe('noiseLine', () => {
  it('is exactly the requested length', () => {
    expect([...noiseLine({ length: 24, random: first })]).toHaveLength(24)
    expect(noiseLine({ length: 0, random: first })).toBe('')
  })

  it('draws every glyph from the noise alphabet', () => {
    let tick = 0
    const sweep = (): number => (tick++ % 6) / 6
    const line = noiseLine({ length: 12, random: sweep })

    for (const glyph of line) expect(NAMING_NOISE).toContain(glyph)
  })

  it('maps the random source onto the alphabet ends', () => {
    expect(noiseLine({ length: 3, random: first })).toBe('···')
    expect(noiseLine({ length: 2, random: last })).toBe('∙∙')
  })
})

describe('streamingLine', () => {
  const title = 'wire the model pick'

  it('opens as pure noise at the start width', () => {
    const line = streamingLine({
      title,
      startLength: 24,
      elapsedMs: 0,
      settleMs: 400,
      random: first,
    })

    expect(line).toBe('·'.repeat(24))
  })

  it('resolves a prefix of the title and glides the width at the midpoint', () => {
    const line = streamingLine({
      title,
      startLength: 24,
      elapsedMs: 200,
      settleMs: 400,
      random: first,
    })

    expect(line).toBe(`wire the ${'·'.repeat(13)}`)
    expect([...line]).toHaveLength(22)
  })

  it('is the plain title once the settle window has passed', () => {
    expect(
      streamingLine({
        title,
        startLength: 24,
        elapsedMs: 400,
        settleMs: 400,
        random: first,
      }),
    ).toBe(title)
    expect(
      streamingLine({
        title,
        startLength: 24,
        elapsedMs: 9_000,
        settleMs: 400,
        random: first,
      }),
    ).toBe(title)
  })

  it('grows into a longer title', () => {
    const line = streamingLine({
      title,
      startLength: 4,
      elapsedMs: 100,
      settleMs: 400,
      random: first,
    })

    expect([...line]).toHaveLength(8)
    expect(line.startsWith('wire')).toBe(true)
  })

  it('treats negative elapsed time as the start', () => {
    expect(
      streamingLine({
        title,
        startLength: 5,
        elapsedMs: -50,
        settleMs: 400,
        random: first,
      }),
    ).toBe('·····')
  })
})
