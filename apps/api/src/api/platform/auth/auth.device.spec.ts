import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeAll, describe, expect, it } from 'vitest'

describe('better-auth device flow over the shared pool', () => {
  const database = useTestDatabase()
  let auth: typeof import('./auth.server').auth

  beforeAll(async () => {
    ;({ auth } = await import('./auth.server'))
  })

  it('issues a device code row', async () => {
    const issued = await auth.api.deviceCode({ body: { client_id: 'atlas-tui' } })

    const rows = await database().db.orm.public.DeviceCode.where({ deviceCode: issued.device_code }).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date)
  })
})
