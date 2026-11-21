import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SandboxSizeSection, savedSizeValueOf } from '../sandbox-size-section'

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

  it('offers an account default only where the setting inherits one', () => {
    const withDefault = renderToStaticMarkup(
      <SandboxSizeSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(withDefault).toContain('Account default')
    expect(html).not.toContain('Account default')
  })
})
