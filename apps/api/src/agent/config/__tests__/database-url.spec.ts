import { describe, expect, it } from 'bun:test'

import { databaseUrlWithTls } from '../database-url'

describe('databaseUrlWithTls', () => {
  it('adds sslmode=require for a remote host', () => {
    expect(databaseUrlWithTls('postgres://u:p@db.render.com:5432/atlas')).toContain(
      'sslmode=require',
    )
  })

  it('leaves a localhost url alone', () => {
    const url = 'postgres://u:p@127.0.0.1:5433/atlas'
    expect(databaseUrlWithTls(url)).toBe(url)
    expect(databaseUrlWithTls('postgres://u:p@localhost/atlas')).toBe(
      'postgres://u:p@localhost/atlas',
    )
  })

  it('leaves an explicit sslmode alone', () => {
    const url = 'postgres://u:p@db.render.com/atlas?sslmode=verify-full'
    expect(databaseUrlWithTls(url)).toBe(url)
  })

  it('rejects an insecure sslmode for a remote host', () => {
    for (const mode of ['disable', 'allow', 'prefer']) {
      expect(() =>
        databaseUrlWithTls(`postgres://u:p@db.render.com/atlas?sslmode=${mode}`),
      ).toThrow(`sslmode=${mode}`)
    }
  })

  it('allows an insecure sslmode for a local host', () => {
    const url = 'postgres://u:p@127.0.0.1:5433/atlas?sslmode=disable'
    expect(databaseUrlWithTls(url)).toBe(url)
  })

  it('the pg connection parser turns sslmode=require into ssl on', async () => {
    const { createRequire } = await import('node:module')
    const requireFromPg = createRequire(import.meta.resolve('@dltech/atlas-db'))
    const ConnectionParameters = requireFromPg('pg/lib/connection-parameters') as new (
      config: object,
    ) => { ssl?: unknown }
    const remote = new ConnectionParameters({
      connectionString: databaseUrlWithTls('postgres://u:p@db.render.com:5432/atlas'),
    })
    expect(remote.ssl).toEqual({})
    const local = new ConnectionParameters({
      connectionString: databaseUrlWithTls('postgres://u:p@127.0.0.1:5433/atlas'),
    })
    expect(local.ssl).toBe(false)
  })
})
