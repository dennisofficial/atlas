import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { CloudflareTunnelClient } from '@dltech/atlas-previews'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { PreviewTunnelService } from './preview-tunnel.service'

const USER_ID = 'usr-1'

const setup = () => {
  const env = new EnvService({
    SECRETS_ENCRYPTION_KEY: '0'.repeat(64),
    PREVIEW_DOMAIN: 'byatlas.dev',
  })
  const cipher = new SecretCipherService(env)
  const cloudflare = new CloudflareTunnelClient({
    apiToken: 'cf-token',
    accountId: 'acct',
    zoneId: 'zone',
  })
  const ensureTunnel = spyOn(cloudflare, 'ensureTunnel').mockResolvedValue({
    id: 'tunnel-1',
    token: 'tunnel-token',
  })
  const findDnsRecord = spyOn(cloudflare, 'findDnsRecord').mockResolvedValue(undefined)
  const createCname = spyOn(cloudflare, 'createCname').mockResolvedValue({ id: 'dns-1' })
  const putIngress = spyOn(cloudflare, 'putIngress').mockResolvedValue(undefined)
  const deleteDnsRecord = spyOn(cloudflare, 'deleteDnsRecord').mockResolvedValue(undefined)
  const deleteTunnel = spyOn(cloudflare, 'deleteTunnel').mockResolvedValue(undefined)
  const service = new PreviewTunnelService(env, cipher, cloudflare)
  return {
    service,
    ensureTunnel,
    findDnsRecord,
    createCname,
    putIngress,
    deleteDnsRecord,
    deleteTunnel,
  }
}

const tunnelOf = (podSessionId: string) =>
  db.orm.public.PreviewTunnel.where({ podSessionId }).first()

const archiveSession = (sessionId: string) =>
  db.orm.public.Session.where({ id: sessionId }).update({ archivedAt: new Date() })

describe('PreviewTunnelService keyed by the pod', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_ID)
    await seedThreadRow({ id: 'lead', userId: USER_ID })
    await seedThreadRow({ id: 'teammate', userId: USER_ID, managedBySessionId: 'ses_lead' })
    await seedSandboxRow({ threadId: 'lead', userId: USER_ID })
  })

  it('exposes a teammate thread on the pod of the session that owns the sandbox', async () => {
    const { service, createCname, ensureTunnel } = setup()

    const exposed = await service.expose({ threadId: 'teammate', userId: USER_ID, port: 3000 })

    const row = await tunnelOf('ses_lead')
    expect(row).toMatchObject({
      podSessionId: 'ses_lead',
      createdByThreadId: 'teammate',
      tunnelId: 'tunnel-1',
      state: 'Ready',
    })
    expect(exposed.url).toBe(`https://3000-${row?.label}.byatlas.dev`)
    expect(ensureTunnel).toHaveBeenCalledWith({ name: 'atlas-ses_lead' })
    expect(createCname).toHaveBeenCalledWith({
      hostname: `3000-${row?.label}.byatlas.dev`,
      tunnelId: 'tunnel-1',
    })
    expect(await tunnelOf('teammate')).toBeNull()
  })

  it('keeps the lead tunnel when a shared teammate thread is torn down', async () => {
    const { service, deleteTunnel, deleteDnsRecord, createCname } = setup()
    await service.expose({ threadId: 'teammate', userId: USER_ID, port: 3000 })
    createCname.mockClear()

    await service.teardown({ threadId: 'teammate' })

    expect(deleteTunnel).not.toHaveBeenCalled()
    expect(deleteDnsRecord).not.toHaveBeenCalled()
    expect((await tunnelOf('ses_lead'))?.state).toBe('Deleting')
  })

  it('deletes the tunnel and its rows once every session of the pod is archived', async () => {
    const { service, deleteTunnel, deleteDnsRecord } = setup()
    await service.expose({ threadId: 'teammate', userId: USER_ID, port: 3000 })
    await archiveSession('ses_lead')
    await archiveSession('ses_teammate')

    await service.teardown({ threadId: 'teammate' })

    expect(deleteDnsRecord).toHaveBeenCalledWith({ recordId: 'dns-1' })
    expect(deleteTunnel).toHaveBeenCalledWith({ tunnelId: 'tunnel-1' })
    expect(await tunnelOf('ses_lead')).toBeNull()
  })
})
