import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SANDBOX_DISK_OPTIONS, SandboxDiskSection, savedDiskValueOf } from '../sandbox-disk-section'

const noop = async () => undefined

describe('savedDiskValueOf', () => {
  it('shows the disk a stored size asks for', () => {
    expect(savedDiskValueOf({ diskGb: 20, withAccountDefault: false })).toBe('20')
    expect(savedDiskValueOf({ diskGb: 100, withAccountDefault: false })).toBe('100')
  })

  it('shows the shipped default when nothing is stored', () => {
    expect(savedDiskValueOf({ diskGb: null, withAccountDefault: false })).toBe('20')
  })

  it('shows the account default when the project has no disk of its own', () => {
    expect(savedDiskValueOf({ diskGb: null, withAccountDefault: true })).toBe('default')
  })

  it('offers only the sizes Agent37 can boot', () => {
    expect(SANDBOX_DISK_OPTIONS.map((option) => option.value)).toEqual([
      '20',
      '30',
      '40',
      '60',
      '80',
      '100',
    ])
  })
})

describe('SandboxDiskSection', () => {
  const html = renderToStaticMarkup(<SandboxDiskSection value={40} onSave={noop} />)

  it('states the intended behaviour in the copy', () => {
    expect(html).toContain('Disk size for new pods.')
    expect(html).toContain('Pods grow automatically when they fill up.')
  })

  it('says the setting is Agent37 only', () => {
    expect(html).toContain('Agent37 pods only.')
  })

  it('shows the stored size', () => {
    expect(html).toContain('40 GB')
  })

  it('offers an account default only where the setting inherits one', () => {
    const withDefault = renderToStaticMarkup(
      <SandboxDiskSection value={null} withAccountDefault onSave={noop} />,
    )
    expect(withDefault).toContain('Account default')
    expect(html).not.toContain('Account default')
  })
})
