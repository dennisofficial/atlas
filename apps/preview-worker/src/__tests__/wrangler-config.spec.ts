import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const config: unknown = Bun.TOML.parse(
  readFileSync(join(import.meta.dir, '../../wrangler.toml'), 'utf8'),
)

const fieldOf = (args: { value: unknown; key: string }): unknown =>
  typeof args.value === 'object' && args.value !== null
    ? Reflect.get(args.value, args.key)
    : undefined

describe('wrangler.toml', () => {
  it('keeps routes at the top level, so a deploy attaches the worker to its hosts', () => {
    expect(fieldOf({ value: config, key: 'routes' })).toEqual([
      { pattern: '*.byatlas.dev/*', zone_name: 'byatlas.dev' },
      { pattern: 'callback.byatlas.dev', custom_domain: true },
    ])
  })

  it('declares only the preview domain as a var', () => {
    expect(fieldOf({ value: config, key: 'vars' })).toEqual({ PREVIEW_DOMAIN: 'byatlas.dev' })
  })
})
