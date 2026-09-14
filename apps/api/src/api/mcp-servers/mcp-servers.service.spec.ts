import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '@core/config/env/env.service'
import { SecretCipherService } from '@lib/crypto/secret-cipher.service'
import type { PrismaClient } from '../../generated/prisma/client'
import type { TransportDto, UpsertMcpServerDto } from './mcp-servers.dto'
import { McpServersService } from './mcp-servers.service'
import { EMcpTransportKind } from './mcp-servers.types'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

interface McpServerRow {
  id: string
  name: string
  sealedSpec: string
  createdAt: Date
  updatedAt: Date
  userId: string
}

type McpServerCreate = Omit<McpServerRow, 'createdAt' | 'updatedAt'>

const fake = vi.hoisted(() => {
  const servers: McpServerRow[] = []

  const db = {
    mcpServerConfig: {
      findMany: async (args: { where: { userId: string } }) =>
        servers
          .filter((row) => row.userId === args.where.userId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      upsert: async (args: {
        where: { userId_name: { userId: string; name: string } }
        create: McpServerCreate
        update: { sealedSpec: string }
      }) => {
        const existing = servers.find(
          (row) =>
            row.userId === args.where.userId_name.userId &&
            row.name === args.where.userId_name.name,
        )
        if (existing) {
          existing.sealedSpec = args.update.sealedSpec
          existing.updatedAt = new Date()
          return existing
        }
        const row = { ...args.create, createdAt: new Date(), updatedAt: new Date() }
        servers.push(row)
        return row
      },
      deleteMany: async (args: { where: { userId: string; name: string } }) => {
        const kept = servers.filter(
          (row) => !(row.userId === args.where.userId && row.name === args.where.name),
        )
        const count = servers.length - kept.length
        servers.splice(0, servers.length, ...kept)
        return { count }
      },
    },
  }

  return { db, servers }
})

vi.mock('@db', () => ({ db: fake.db as unknown as PrismaClient }))

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
  let service: McpServersService

  beforeEach(() => {
    fake.servers.length = 0
    service = new McpServersService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
    )
  })

  it('put seals the spec and list returns it opened', async () => {
    await service.put({ userId: USER_A, name: 'fs', spec: { transport: stdioTransport() } })

    const stored = fake.servers[0]
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
    await expect(
      service.put({ userId: USER_A, name: 'empty', spec: { trusted: true } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fake.servers).toHaveLength(0)
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
    expect(fake.servers).toHaveLength(1)
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
    const sealedBefore = fake.servers[0]?.sealedSpec

    await service.put({ userId: USER_A, name: 'fs', spec: { disabled: true, trusted: true } })

    expect(fake.servers).toHaveLength(1)
    expect(fake.servers[0]?.sealedSpec).not.toBe(sealedBefore)
    const listed = await service.list({ userId: USER_A })
    expect(listed[0]).toMatchObject({ name: 'fs', disabled: true, trusted: true })
    expect(listed[0]).not.toHaveProperty('transport')
  })

  it('scopes every operation to the owning user', async () => {
    await service.put({ userId: USER_A, name: 'fs', spec: { transport: stdioTransport() } })

    expect(await service.list({ userId: USER_B })).toEqual([])

    await service.put({ userId: USER_B, name: 'fs', spec: { transport: httpTransport() } })
    await service.remove({ userId: USER_A, name: 'fs' })
    await service.remove({ userId: USER_A, name: 'never-existed' })

    expect(fake.servers).toHaveLength(1)
    expect((await service.list({ userId: USER_B }))[0]?.transport).toMatchObject({
      kind: 'http',
    })
  })
})
