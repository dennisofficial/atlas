import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { McpServerConfigModel } from '@db'
import { db } from '@db'
import { SecretCipherService } from '@lib/crypto/secret-cipher.service'
import type { UpsertMcpServerDto } from './mcp-servers.dto'
import type { McpServerDto, McpSpec, McpTransport } from './mcp-servers.types'
import { EMcpTransportKind } from './mcp-servers.types'

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

function assertValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new BadRequestException(
      'a server name holds only letters, digits, underscores and hyphens',
    )
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

function toTransport(dto: UpsertMcpServerDto['transport']): McpTransport {
  if (!dto) throw new BadRequestException('transport must be an object')
  if (dto.kind === EMcpTransportKind.Stdio) {
    if (typeof dto.command !== 'string' || dto.command.length === 0) {
      throw new BadRequestException('a stdio server needs a command to spawn')
    }
    if (dto.env !== undefined && !isStringRecord(dto.env)) {
      throw new BadRequestException('stdio env values must be strings')
    }
    return {
      kind: EMcpTransportKind.Stdio,
      command: dto.command,
      ...(dto.args === undefined ? {} : { args: dto.args }),
      ...(dto.env === undefined ? {} : { env: dto.env }),
    }
  }
  if (dto.kind === EMcpTransportKind.Http) {
    const url = parseHttpUrl(dto.url)
    if (dto.headers !== undefined && !isStringRecord(dto.headers)) {
      throw new BadRequestException('http header values must be strings')
    }
    return {
      kind: EMcpTransportKind.Http,
      url,
      ...(dto.headers === undefined ? {} : { headers: dto.headers }),
    }
  }
  throw new BadRequestException("transport kind must be 'stdio' or 'http'")
}

function parseHttpUrl(url: string | undefined): string {
  if (typeof url !== 'string') {
    throw new BadRequestException('an http server needs a url')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BadRequestException('an http server url must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('an http server url must start with http:// or https://')
  }
  return url
}

export function toMcpSpec(draft: UpsertMcpServerDto & { name: string }): McpSpec {
  assertValidName(draft.name)
  const transport = draft.transport === undefined ? undefined : toTransport(draft.transport)
  if (transport === undefined && draft.disabled !== true) {
    throw new BadRequestException('a server that is not disabled needs a transport')
  }
  return {
    name: draft.name,
    ...(transport === undefined ? {} : { transport }),
    ...(draft.disabled === undefined ? {} : { disabled: draft.disabled }),
    ...(draft.trusted === undefined ? {} : { trusted: draft.trusted }),
  }
}

@Injectable()
export class McpServersService {
  constructor(private readonly cipher: SecretCipherService) {}

  async list(args: { userId: string }): Promise<McpServerDto[]> {
    const rows = await db.mcpServerConfig.findMany({
      where: { userId: args.userId },
      orderBy: { name: 'asc' },
    })
    return rows.map((row) => this.toServerDto(row))
  }

  async put(args: { userId: string; name: string; spec: UpsertMcpServerDto }): Promise<void> {
    const spec = toMcpSpec({ ...args.spec, name: args.name })
    const sealedSpec = this.cipher.encrypt(JSON.stringify(spec))
    await db.mcpServerConfig.upsert({
      where: { userId_name: { userId: args.userId, name: args.name } },
      create: {
        id: `mcp_${randomUUID()}`,
        name: args.name,
        sealedSpec,
        userId: args.userId,
      },
      update: { sealedSpec },
    })
  }

  async remove(args: { userId: string; name: string }): Promise<void> {
    assertValidName(args.name)
    await db.mcpServerConfig.deleteMany({
      where: { userId: args.userId, name: args.name },
    })
  }

  private toServerDto(row: McpServerConfigModel): McpServerDto {
    const spec = toMcpSpec(JSON.parse(this.cipher.decrypt(row.sealedSpec)) as UpsertMcpServerDto & {
      name: string
    })
    return { ...spec, updatedAt: row.updatedAt.toISOString() }
  }
}
