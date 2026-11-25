import { EConfigLayer, type LayerItems } from '@dltech/atlas-core'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { EMcpServerScope, type McpServerLayers } from '@dltech/atlas-wire'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { PERSONAL_LAYER_OWNER } from '../../../_lib/config-layers/layer-owner'
import { layeredItemsOf } from '../layers/layered-items'
import { GroupsService } from '../project-groups/project-groups.service'
import { ProjectsService } from '../projects/projects.service'
import { openMcpServer, sealMcpSpec } from './mcp-sealed'
import { putCloudServer } from './mcp-servers-put'
import type { McpServerDto, McpSpec, McpSpecDraft, McpTransport } from './mcp-servers.types'
import { EMcpTransportKind } from './mcp-servers.types'

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const GROUP_MISSING = 'scope=group requires a groupId'

const PROJECT_MISSING = 'scope=project requires a projectId'

const ID_PREFIX: Readonly<Record<EMcpServerScope, 'mcp_' | 'gmcp_' | 'pmcp_'>> = {
  [EMcpServerScope.Personal]: 'mcp_',
  [EMcpServerScope.Group]: 'gmcp_',
  [EMcpServerScope.Project]: 'pmcp_',
}

type Scope = {
  scope: EMcpServerScope
  projectId?: string | undefined
  groupId?: string | undefined
}

type Owner = { userId: string } | { projectId: string } | { groupId: string }

type Placement = {
  group: { id: string; name: string } | null
  project: { id: string; name: string } | null
}

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
    ...(draft.proxy === undefined ? {} : { proxy: draft.proxy }),
  }
}

@Injectable()
export class McpServersService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly projects: ProjectsService,
    private readonly groups: GroupsService,
  ) {}

  async list(args: Scope & { userId: string }): Promise<McpServerDto[]> {
    return await this.rowsOf({ owner: await this.ownerOf(args) })
  }

  async put(args: Scope & { userId: string; name: string; spec: McpSpecDraft }): Promise<void> {
    const owner = await this.ownerOf(args)
    const sealedSpec = sealMcpSpec({ cipher: this.cipher, name: args.name, spec: args.spec })
    await putCloudServer({
      cipher: this.cipher,
      scope: owner,
      idPrefix: ID_PREFIX[args.scope],
      name: args.name,
      sealedSpec,
    })
  }

  async remove(args: Scope & { userId: string; name: string }): Promise<void> {
    assertValidName(args.name)
    await db.orm.public.McpServer.where({
      ...(await this.ownerOf(args)),
      source: 'cloud',
      name: args.name,
    }).deleteAndCount()
  }

  async layered(args: Scope & { userId: string }): Promise<McpServerLayers> {
    const placement = await this.placementOf(args)
    const layers: LayerItems<McpServerDto>[] = [
      {
        layer: EConfigLayer.Personal,
        items: await this.rowsOf({ owner: { userId: args.userId } }),
      },
    ]
    if (placement.group !== null) {
      layers.push({
        layer: EConfigLayer.Group,
        items: await this.rowsOf({ owner: { groupId: placement.group.id } }),
      })
    }
    if (placement.project !== null) {
      layers.push({
        layer: EConfigLayer.Project,
        items: await this.rowsOf({ owner: { projectId: placement.project.id } }),
      })
    }
    const repo = await this.repoRowsOf({
      owners: [
        { userId: args.userId },
        ...(placement.group === null ? [] : [{ groupId: placement.group.id }]),
        ...(placement.project === null ? [] : [{ projectId: placement.project.id }]),
      ],
    })
    if (repo.length > 0) layers.push({ layer: EConfigLayer.Repo, items: repo })
    return {
      layers: layeredItemsOf({
        layers,
        ownerOf: (layer) => {
          if (layer === EConfigLayer.Personal) return PERSONAL_LAYER_OWNER
          if (layer === EConfigLayer.Group) {
            return placement.group === null
              ? { id: null, name: '' }
              : { id: placement.group.id, name: placement.group.name }
          }
          if (layer === EConfigLayer.Project) {
            return placement.project === null
              ? { id: null, name: '' }
              : { id: placement.project.id, name: placement.project.name }
          }
          return { id: null, name: 'repository' }
        },
      }),
    }
  }

  private async ownerOf(args: Scope & { userId: string }): Promise<Owner> {
    if (args.scope === EMcpServerScope.Personal) return { userId: args.userId }
    if (args.scope === EMcpServerScope.Group) {
      if (args.groupId === undefined) throw new BadRequestException(GROUP_MISSING)
      await this.groups.owned({ userId: args.userId, groupId: args.groupId })
      return { groupId: args.groupId }
    }
    if (args.projectId === undefined) throw new BadRequestException(PROJECT_MISSING)
    await this.projects.read({ userId: args.userId, projectId: args.projectId })
    return { projectId: args.projectId }
  }

  private async placementOf(args: Scope & { userId: string }): Promise<Placement> {
    if (args.scope === EMcpServerScope.Personal) return { group: null, project: null }
    if (args.scope === EMcpServerScope.Group) {
      if (args.groupId === undefined) throw new BadRequestException(GROUP_MISSING)
      const group = await this.groups.owned({ userId: args.userId, groupId: args.groupId })
      return { group: { id: group.id, name: group.name }, project: null }
    }
    if (args.projectId === undefined) throw new BadRequestException(PROJECT_MISSING)
    const project = await this.projects.read({ userId: args.userId, projectId: args.projectId })
    const group =
      project.groupId === null
        ? null
        : await db.orm.public.ProjectGroup.first({ id: project.groupId })
    return {
      group: group === null ? null : { id: group.id, name: group.name },
      project: { id: project.id, name: project.name },
    }
  }

  private async rowsOf(args: { owner: Owner }): Promise<McpServerDto[]> {
    const rows = await db.orm.public.McpServer.where({ ...args.owner, source: 'cloud' })
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => this.toServerDto(row))
  }

  private async repoRowsOf(args: { owners: readonly Owner[] }): Promise<McpServerDto[]> {
    const reads = await Promise.all(
      args.owners.map((owner) =>
        db.orm.public.McpServer.where({ ...owner, source: 'repo' })
          .orderBy((row) => row.name.asc())
          .all(),
      ),
    )
    return reads.flat().map((row) => ({ name: row.name, updatedAt: row.updatedAt.toISOString() }))
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
