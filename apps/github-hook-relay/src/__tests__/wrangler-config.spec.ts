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
  it('keeps the relay host as a top-level custom domain, so a deploy attaches it', () => {
    expect(fieldOf({ value: config, key: 'routes' })).toEqual([
      { pattern: 'hooks.byatlas.io', custom_domain: true },
    ])
  })

  it('points the worker at the production API', () => {
    expect(fieldOf({ value: config, key: 'vars' })).toEqual({
      API_ORIGIN: 'https://api.byatlas.io',
    })
  })

  it('never serves a workers.dev host', () => {
    expect(fieldOf({ value: config, key: 'workers_dev' })).toBe(false)
  })
})
