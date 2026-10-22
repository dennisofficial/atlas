import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import type { TransportDto, UpsertMcpServerDto } from './mcp-servers.dto'
import { McpServersService } from './mcp-servers.service'
import { EMcpTransportKind } from './mcp-servers.types'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const USER_A = 'user-a'
const USER_B = 'user-b'

function stdioTransport(extra?: Partial<TransportDto>): TransportDto {
  return { kind: EMcpTransportKind.Stdio, command: 'npx', args: ['-y', 'some-server'], ...extra }
}

function httpTransport(extra?: Partial<TransportDto>): TransportDto {
  return {
    kind: EMcpTransportKind.Http,
    url: 'https://mcp.example.com/sse',
    headers: { authorization: 'Bearer token' },
    ...extra,
  }
}

describe('McpServersService', () => {
  const database = useTestDatabase()
  const servers = () => db.orm.public.UserMcpServer.where((row) => row.id.neq('')).all()
  let service: McpServersService

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db: database().db, id })
    service = new McpServersService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
    )
  })

  it('put seals the spec and list returns it opened', async () => {
    await service.put({ userId: USER_A, name: 'fs', spec: { transport: stdioTransport() } })

    const stored = (await servers())[0]
    expect(stored?.id).toMatch(/^mcp_/)
    expect(stored?.sealedSpec).not.toContain('some-server')

    const listed = await service.list({ userId: USER_A })
    expect(listed).toEqual([
      {
        name: 'fs',
        transport: { kind: 'stdio', command: 'npx', args: ['-y', 'some-server'] },
        updatedAt: stored?.updatedAt.toISOString(),
      },
    ])
  })

  it('accepts an http transport with headers', async () => {
    await service.put({ userId: USER_A, name: 'remote', spec: { transport: httpTransport() } })

    expect((await service.list({ userId: USER_A }))[0]?.transport).toEqual({
      kind: 'http',
      url: 'https://mcp.example.com/sse',
      headers: { authorization: 'Bearer token' },
    })
  })

  it('accepts a disabled server with no transport', async () => {
    await service.put({ userId: USER_A, name: 'paused', spec: { disabled: true } })

    const listed = await service.list({ userId: USER_A })
    expect(listed[0]).toMatchObject({ name: 'paused', disabled: true })
    expect(listed[0]).not.toHaveProperty('transport')
  })

  it('rejects a server that is neither disabled nor carrying a transport', async () => {
    await expect(service.put({ userId: USER_A, name: 'empty', spec: {} })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(await servers()).toHaveLength(0)
  })

  it('rejects a stdio transport without a command and an http transport with a bad url', async () => {
    await expect(
      service.put({
        userId: USER_A,
        name: 'fs',
        spec: { transport: { kind: EMcpTransportKind.Stdio } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.put({
        userId: USER_A,
        name: 'remote',
        spec: { transport: httpTransport({ url: 'ftp://nope' }) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.put({
        userId: USER_A,
        name: 'remote',
        spec: { transport: httpTransport({ url: 'not a url' }) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects transport record values that are not strings', async () => {
    const spec = {
      transport: { kind: 'stdio', command: 'npx', env: { LEVEL: 3 } },
    } as unknown as UpsertMcpServerDto

    await expect(service.put({ userId: USER_A, name: 'fs', spec })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects names outside the pattern', async () => {
    await expect(
      service.put({ userId: USER_A, name: 'has spaces', spec: { transport: stdioTransport() } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.put({ userId: USER_A, name: 'dots.not-ok', spec: { transport: stdioTransport() } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.remove({ userId: USER_A, name: 'bad name' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await service.put({ userId: USER_A, name: 'ok_Name-9', spec: { transport: stdioTransport() } })
    expect(await servers()).toHaveLength(1)
  })

  it('strips keys the harness spec would reject', async () => {
    await service.put({
      userId: USER_A,
      name: 'fs',
      spec: { transport: stdioTransport({ url: 'https://stray.example.com' }) },
    })

    const listed = await service.list({ userId: USER_A })
    expect(listed[0]?.transport).toEqual({ kind: 'stdio', command: 'npx', args: ['-y', 'some-server'] })
    expect(JSON.stringify(listed[0])).not.toContain('stray.example.com')
  })

  it('put upserts an existing name', async () => {
    await service.put({ userId: USER_A, name: 'fs', spec: { transport: stdioTransport() } })
    const sealedBefore = (await servers())[0]?.sealedSpec

    await service.put({ userId: USER_A, name: 'fs', spec: { disabled: true } })

    const rows = await servers()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sealedSpec).not.toBe(sealedBefore)
    const listed = await service.list({ userId: USER_A })
    expect(listed[0]).toMatchObject({ name: 'fs', disabled: true })
    expect(listed[0]).not.toHaveProperty('transport')
  })

  it('scopes every operation to the owning user', async () => {
    await service.put({ userId: USER_A, name: 'fs', spec: { transport: stdioTransport() } })

    expect(await service.list({ userId: USER_B })).toEqual([])

    await service.put({ userId: USER_B, name: 'fs', spec: { transport: httpTransport() } })
    await service.remove({ userId: USER_A, name: 'fs' })
    await service.remove({ userId: USER_A, name: 'never-existed' })

    expect(await servers()).toHaveLength(1)
    expect((await service.list({ userId: USER_B }))[0]?.transport).toMatchObject({
      kind: 'http',
    })
  })
})
