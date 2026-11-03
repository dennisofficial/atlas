import { BadRequestException, Injectable } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openMcpServer, sealMcpSpec } from './mcp-sealed'
import { putCloudServer } from './mcp-servers-put'
import type { McpServerDto, McpSpec, McpSpecDraft, McpTransport } from './mcp-servers.types'
import { EMcpTransportKind } from './mcp-servers.types'

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export function assertValidName(name: string): void {
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

function toTransport(dto: McpSpecDraft['transport']): McpTransport {
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

export function toMcpSpec(draft: McpSpecDraft & { name: string }): McpSpec {
  assertValidName(draft.name)
  const transport = draft.transport === undefined ? undefined : toTransport(draft.transport)
  if (transport === undefined && draft.disabled !== true) {
    throw new BadRequestException('a server that is not disabled needs a transport')
  }
  return {
    name: draft.name,
    ...(transport === undefined ? {} : { transport }),
    ...(draft.disabled === undefined ? {} : { disabled: draft.disabled }),
  }
}

@Injectable()
export class McpServersService {
  constructor(private readonly cipher: SecretCipherService) {}

  async list(args: { userId: string }): Promise<McpServerDto[]> {
    const rows = await db.orm.public.McpServer.where({ userId: args.userId, source: 'cloud' })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => this.toServerDto(row))
  }

  async put(args: { userId: string; name: string; spec: McpSpecDraft }): Promise<void> {
    const sealedSpec = sealMcpSpec({ cipher: this.cipher, name: args.name, spec: args.spec })
    await putCloudServer({
      cipher: this.cipher,
      scope: { userId: args.userId },
      idPrefix: 'mcp_',
      name: args.name,
      sealedSpec,
    })
  }

  async remove(args: { userId: string; name: string }): Promise<void> {
    assertValidName(args.name)
    await db.orm.public.McpServer.where({
      userId: args.userId,
      source: 'cloud',
      name: args.name,
    }).deleteAndCount()
  }

  private toServerDto(row: Row<'McpServer'>): McpServerDto {
    if (row.sealedSpec === null) throw new Error('a cloud server row holds a sealed spec')
    return openMcpServer({
      cipher: this.cipher,
      sealedSpec: row.sealedSpec,
      updatedAt: row.updatedAt,
    })
  }
}
