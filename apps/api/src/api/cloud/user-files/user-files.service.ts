import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db } from '../../../db'
import { isUniqueViolation } from '../github/unique-violation'
import { UserFilesFanoutService } from './user-files.fanout'
import {
  USER_FILE_TREES,
  type UserFileDto,
  type UserFileTree,
  type UserFileWithContentDto,
} from './user-files.types'

const MAX_PATH_LENGTH = 500
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const META_SELECT = {
  path: true,
  revision: true,
  contentHash: true,
  tombstonedAt: true,
} as const

type MetaRow = {
  path: string
  revision: number
  contentHash: string
  tombstonedAt: Date | null
}

type ContentRow = MetaRow & { content: Uint8Array | null }

function assertValidTree(tree: string): UserFileTree {
  const known = USER_FILE_TREES.find((candidate) => candidate === tree)
  if (known === undefined) {
    throw new BadRequestException(`a tree must be one of ${USER_FILE_TREES.join(', ')}`)
  }
  return known
}

function assertValidPath(path: string): void {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new BadRequestException(
      `a path must be a non-empty string of at most ${MAX_PATH_LENGTH} characters`,
    )
  }
  if (path.startsWith('/')) throw new BadRequestException('a path must be relative')
  if (path.includes('\\') || path.includes('\0')) {
    throw new BadRequestException('a path must not contain backslashes or NUL')
  }
  for (const segment of path.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new BadRequestException('a path must not contain empty, `.` or `..` segments')
    }
    if (segment !== segment.trim()) {
      throw new BadRequestException('a path segment must not have surrounding whitespace')
    }
  }
}

function decodeContent(args: { content: string; contentHash: string }): Uint8Array<ArrayBuffer> {
  if (!BASE64_PATTERN.test(args.content)) {
    throw new BadRequestException('content must be base64')
  }
  const bytes = new Uint8Array(Buffer.from(args.content, 'base64'))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== args.contentHash.toLowerCase()) {
    throw new BadRequestException('contentHash does not match the content')
  }
  return bytes
}

function toMetaDto(row: MetaRow): UserFileDto {
  return {
    path: row.path,
    revision: row.revision,
    contentHash: row.contentHash,
    tombstonedAt: row.tombstonedAt?.toISOString() ?? null,
  }
}

function toContentDto(row: ContentRow): UserFileWithContentDto {
  return {
    ...toMetaDto(row),
    content: row.content === null ? null : Buffer.from(row.content).toString('base64'),
  }
}

@Injectable()
export class UserFilesService {
  constructor(private readonly fanout: UserFilesFanoutService) {}

  async list(args: {
    userId: string
    tree: string
    sinceRevision?: number | undefined
  }): Promise<UserFileDto[]> {
    const tree = assertValidTree(args.tree)
    const rows = await db.userFile.findMany({
      where: {
        userId: args.userId,
        tree,
        ...(args.sinceRevision === undefined ? {} : { revision: { gt: args.sinceRevision } }),
      },
      select: META_SELECT,
      orderBy: { revision: 'asc' },
    })
    return rows.map((row) => toMetaDto(row))
  }

  async getMany(args: {
    userId: string
    tree: string
    paths: string[]
  }): Promise<UserFileWithContentDto[]> {
    const tree = assertValidTree(args.tree)
    for (const path of args.paths) assertValidPath(path)
    const rows = await db.userFile.findMany({
      where: { userId: args.userId, tree, path: { in: args.paths } },
      orderBy: { path: 'asc' },
    })
    return rows.map((row) => toContentDto(row))
  }

  async put(args: {
    userId: string
    tree: string
    path: string
    content: string
    contentHash: string
    baseRevision: number
  }): Promise<{ revision: number }> {
    const tree = assertValidTree(args.tree)
    assertValidPath(args.path)
    const content = decodeContent({ content: args.content, contentHash: args.contentHash })
    const contentHash = args.contentHash.toLowerCase()
    const key = { userId: args.userId, tree, path: args.path }

    const existing = await db.userFile.findUnique({ where: { userId_tree_path: key } })
    if (existing === null) {
      if (args.baseRevision !== 0) throw conflictOf({ revision: 0, contentHash: '' })
      await this.createFirstRevision({ key, content, contentHash })
    } else {
      await this.replaceRevision({
        key,
        baseRevision: args.baseRevision,
        data: { contentHash, content, tombstonedAt: null },
        currentRevision: existing.revision,
        currentHash: existing.contentHash,
      })
    }
    const revision = args.baseRevision + 1
    this.fanout.publish({ userId: args.userId, change: { tree, path: args.path, revision } })
    return { revision }
  }

  async remove(args: {
    userId: string
    tree: string
    path: string
    baseRevision: number
  }): Promise<{ revision: number }> {
    const tree = assertValidTree(args.tree)
    assertValidPath(args.path)
    const key = { userId: args.userId, tree, path: args.path }

    const existing = await db.userFile.findUnique({ where: { userId_tree_path: key } })
    if (existing === null) throw new NotFoundException('no such file')
    await this.replaceRevision({
      key,
      baseRevision: args.baseRevision,
      data: { contentHash: '', content: null, tombstonedAt: new Date() },
      currentRevision: existing.revision,
      currentHash: existing.contentHash,
    })
    const revision = args.baseRevision + 1
    this.fanout.publish({ userId: args.userId, change: { tree, path: args.path, revision } })
    return { revision }
  }

  private async createFirstRevision(args: {
    key: { userId: string; tree: string; path: string }
    content: Uint8Array<ArrayBuffer>
    contentHash: string
  }): Promise<void> {
    try {
      await db.userFile.create({
        data: { ...args.key, revision: 1, contentHash: args.contentHash, content: args.content },
      })
    } catch (failure) {
      if (!isUniqueViolation(failure, ['userId', 'tree', 'path'])) throw failure
      throw await this.currentConflict({ key: args.key })
    }
  }

  private async replaceRevision(args: {
    key: { userId: string; tree: string; path: string }
    baseRevision: number
    data: { contentHash: string; content: Uint8Array<ArrayBuffer> | null; tombstonedAt: Date | null }
    currentRevision: number
    currentHash: string
  }): Promise<void> {
    if (args.currentRevision !== args.baseRevision) {
      throw conflictOf({ revision: args.currentRevision, contentHash: args.currentHash })
    }
    const { count } = await db.userFile.updateMany({
      where: { ...args.key, revision: args.baseRevision },
      data: { ...args.data, revision: args.baseRevision + 1 },
    })
    if (count === 0) throw await this.currentConflict({ key: args.key })
  }

  private async currentConflict(args: {
    key: { userId: string; tree: string; path: string }
  }): Promise<ConflictException> {
    const current = await db.userFile.findUnique({ where: { userId_tree_path: args.key } })
    return conflictOf({ revision: current?.revision ?? 0, contentHash: current?.contentHash ?? '' })
  }
}

function conflictOf(current: { revision: number; contentHash: string }): ConflictException {
  return new ConflictException({
    statusCode: 409,
    message: 'the file changed since baseRevision',
    currentRevision: current.revision,
    contentHash: current.contentHash,
  })
}
