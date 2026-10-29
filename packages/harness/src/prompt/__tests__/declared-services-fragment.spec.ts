import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DeclaredServicesFragment } from '../fragments/services'
import { contextFor } from './fake-fragments'

let root: string

const writeServices = ({ text }: { text: string }): void => {
  mkdirSync(join(root, '.atlas'), { recursive: true })
  writeFileSync(join(root, '.atlas', 'services.yaml'), text)
}

const ctx = () => contextFor({ modelId: 'm', projectDirectory: root })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'services-fragment-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('DeclaredServicesFragment', () => {
  it('is empty when the workspace declares no services', () => {
    expect(new DeclaredServicesFragment().text(ctx())).toBe('')
  })

  it('lists declared names and points at services_ensure', () => {
    writeServices({
      text: 'services:\n  web:\n    command: bun dev\n  api:\n    command: bun api\n',
    })
    const text = new DeclaredServicesFragment().text(ctx())
    expect(text).toContain('services_ensure')
    expect(text).toContain('Declared services: web, api.')
  })

  it('reports loader rejections', () => {
    writeServices({ text: 'services:\n  Bad_Name:\n    command: x\n  ok:\n    command: y\n' })
    const text = new DeclaredServicesFragment().text(ctx())
    expect(text).toContain('Declared services: ok.')
    expect(text).toContain('Rejected (service Bad_Name)')
  })

  it('reports an unparseable file', () => {
    writeServices({ text: 'services: [unclosed' })
    expect(new DeclaredServicesFragment().text(ctx())).toContain('Rejected (file)')
  })

  it('restamps when the file changes', () => {
    const fragment = new DeclaredServicesFragment()
    const before = fragment.stamp(ctx())
    writeServices({ text: 'services:\n  web:\n    command: x\n' })
    expect(fragment.stamp(ctx())).not.toBe(before)
  })
})
