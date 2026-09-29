import { describe, expect, it } from 'bun:test'

import { reasonClassOf } from '../reason-class'

describe('reasonClassOf', () => {
  it('classes the known refusals without carrying their text', () => {
    expect(reasonClassOf('Refusing to write to /Users/dennis/secret/thing.ts')).toBe('write-refusal')
    expect(reasonClassOf('write would replace all of /repo/src/file.ts')).toBe('write-replaces-whole-file')
    expect(reasonClassOf('edit would change part of /repo/src/file.ts')).toBe('edit-partial-change')
    expect(reasonClassOf('the sandbox owns the transcript')).toBe('sandbox-owns-transcript')
    expect(reasonClassOf('the write tool rejected this input: path: required')).toBe('invalid-input')
  })

  it('falls back to other for anything unrecognized', () => {
    expect(reasonClassOf('something entirely different happened')).toBe('other')
    expect(reasonClassOf('')).toBe('other')
  })

  it('never leaks the path embedded in a reason', () => {
    const classified = reasonClassOf('Refusing to write to /Users/dennislysenko/Developer/atlas/x.ts')
    expect(classified.includes('/')).toBe(false)
    expect(classified.includes('dennis')).toBe(false)
  })
})
