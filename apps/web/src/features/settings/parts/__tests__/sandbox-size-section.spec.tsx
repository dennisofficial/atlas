import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SandboxSizeSection, savedSizeValueOf, sizeValueToSave } from '../sandbox-size-section'

const noop = async () => undefined

describe('savedSizeValueOf', () => {
  it('shows the size a stored vcpus count really boots', () => {
    expect(savedSizeValueOf({ vcpus: 2, withAccountDefault: false })).toBe('2')
    expect(savedSizeValueOf({ vcpus: 4, withAccountDefault: false })).toBe('4')
    expect(savedSizeValueOf({ vcpus: 8, withAccountDefault: false })).toBe('8')
  })

  it('maps a stored size with no matching shape to the shape it boots', () => {
    expect(savedSizeValueOf({ vcpus: 6, withAccountDefault: false })).toBe('8')
    expect(savedSizeValueOf({ vcpus: 32, withAccountDefault: false })).toBe('8')
    expect(savedSizeValueOf({ vcpus: 1, withAccountDefault: false })).toBe('2')
  })

  it('shows the account default when the project has no size of its own', () => {
    expect(savedSizeValueOf({ vcpus: null, withAccountDefault: true })).toBe('default')
  })
})

describe('SandboxSizeSection', () => {
  const html = renderToStaticMarkup(<SandboxSizeSection value={4} onSave={noop} />)

  it('describes the machine a sandbox boots on without a per-vCPU memory claim', () => {
    expect(html).toContain('The machine a new cloud sandbox boots on.')
    expect(html).toContain('resize a running one from its session')
    expect(html).not.toContain('2 GB RAM each')
  })

  it('names no Vercel plan cap', () => {
    expect(html).not.toContain('Enterprise')
    expect(html).not.toContain('Hobby')
    expect(html).not.toContain('Pro up to')
  })

  it('shows the shape the stored size boots', () => {
    const oversized = renderToStaticMarkup(<SandboxSizeSection value={32} onSave={noop} />)
    expect(oversized).toContain('8 vCPU')
    expect(html).toContain('4 vCPU')
  })

  it('offers Default only where the setting inherits one', () => {
    const withDefault = renderToStaticMarkup(
      <SandboxSizeSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(withDefault).toContain('Default')
    expect(withDefault).not.toContain('Account default')
    expect(html).not.toContain('Default')
  })

  it('shows the inherited shape dimmed under Default', () => {
    const inherited = renderToStaticMarkup(
      <SandboxSizeSection value={null} inheritedVcpus={4} withAccountDefault onSave={noop} />,
    )
    expect(inherited).toContain('4 vCPU · 8 GB RAM')
    expect(inherited).toContain('text-muted-foreground')
  })

  it('shows the built-in default shape when there is no personal size', () => {
    const fallback = renderToStaticMarkup(
      <SandboxSizeSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(fallback).toContain('2 vCPU · 4 GB RAM')
  })
})

describe('sizeValueToSave', () => {
  it('saves Default as null so the project keeps inheriting', () => {
    expect(sizeValueToSave({ selected: 'default', withAccountDefault: true })).toBeNull()
    expect(sizeValueToSave({ selected: '4', withAccountDefault: true })).toBe(4)
  })
})
