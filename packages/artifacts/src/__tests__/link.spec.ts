import { describe, expect, it } from 'bun:test'

import { linkedSpecText, linkedSubdomainOf } from '../link'
import { ArtifactSpecError, parseSpec, specHash } from '../spec'
import { ArtifactSubdomainError } from '../subdomain'

const LINKED = 'k7f2m9qxabcd'

describe('linkedSubdomainOf', () => {
  it('reads the subdomain an artifact.json links to', () => {
    expect(linkedSubdomainOf({ subdomain: LINKED, serve: { spa: true } })).toBe(LINKED)
  })

  it.each([{}, { serve: { spa: true } }])('answers null for the unlinked spec %p', (raw) => {
    expect(linkedSubdomainOf(raw)).toBeNull()
  })

  it.each(['Upper', 'has space', '', 42, null])('refuses the link %p', (value) => {
    expect(() => linkedSubdomainOf({ subdomain: value })).toThrow(ArtifactSpecError)
  })
})

describe('linkedSpecText', () => {
  it('writes the link first and keeps every other setting', () => {
    expect(linkedSpecText({ raw: { serve: { spa: true } }, subdomain: LINKED })).toBe(
      '{\n  "subdomain": "k7f2m9qxabcd",\n  "serve": {\n    "spa": true\n  }\n}\n',
    )
  })

  it('writes a spec of its own for a directory that has none', () => {
    expect(linkedSpecText({ raw: {}, subdomain: LINKED })).toBe(
      '{\n  "subdomain": "k7f2m9qxabcd"\n}\n',
    )
  })

  it('replaces an earlier link', () => {
    const text = linkedSpecText({
      raw: { serve: { spa: true }, subdomain: 'old' },
      subdomain: LINKED,
    })

    expect(JSON.parse(text)).toEqual({ subdomain: LINKED, serve: { spa: true } })
    expect(Object.keys(JSON.parse(text))).toEqual(['subdomain', 'serve'])
  })

  it('refuses to write a link that is not a subdomain', () => {
    expect(() => linkedSpecText({ raw: {}, subdomain: 'Not A Subdomain' })).toThrow(
      ArtifactSubdomainError,
    )
  })

  it('refuses a spec that is not a JSON object', () => {
    expect(() => linkedSpecText({ raw: ['serve'], subdomain: LINKED })).toThrow(ArtifactSpecError)
  })
})

describe('the link', () => {
  it('is not an artifact setting, so linking never changes the spec hash', () => {
    const linked = parseSpec({ subdomain: LINKED, serve: { spa: true } })

    expect(linked).not.toHaveProperty('subdomain')
    expect(specHash(linked)).toBe(specHash(parseSpec({ serve: { spa: true } })))
  })
})
