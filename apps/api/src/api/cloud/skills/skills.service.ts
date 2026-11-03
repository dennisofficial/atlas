import { createHash } from 'node:crypto'
import { SKILL_NAME_MAX_LENGTH } from '@dltech/atlas-core'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db, isUniqueViolation, violatedConstraint, type Row } from '@dltech/atlas-db'
import { parseSkillSpec } from '@dltech/atlas-harness/skill-specs'
import { builtInSkills } from '@dltech/atlas-harness/skill-catalogue'
import {
  ESkillOrigin,
  ESkillScope,
  SKILL_TEXT_EXTENSIONS,
  type SkillFileContent,
  type SkillFileMeta,
  type SkillSummary,
  type SkillUsage,
} from '@dltech/atlas-wire'
import { ProjectsService } from '../projects/projects.service'
import { SkillUsageService } from './skill-usage.service'
import { builtInSkill, isBuiltIn, readBuiltInFile } from './builtin-skill-source'

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MAX_PATH_LENGTH = 500
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const SKILL_FILE_KEY_CONSTRAINT = 'SkillFile_skillId_path_key'
const SKILL_ENTRY = 'SKILL.md'

type Scope = { scope: ESkillScope; projectId?: string | undefined }

const SKILL_OWNER_MISSING = 'scope=project requires a projectId'

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

function isTextPath(path: string): boolean {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (SKILL_TEXT_EXTENSIONS as readonly string[]).includes(extension)
}

function descriptionOf(args: { text: string; skill: string }): string {
  const parsed = parseSkillSpec({ text: args.text, fallbackName: args.skill })
  return parsed === undefined ? '' : parsed.spec.summary
}

function toMetaDto(row: Row<'SkillFile'>): SkillFileMeta {
  return {
    path: row.path,
    revision: row.revision,
    contentHash: row.contentHash,
    sizeBytes: row.size,
    isText: row.isText,
    updatedAt: row.updatedAt.toISOString(),
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

@Injectable()
export class SkillsService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly usage: SkillUsageService,
  ) {}

  private async resolveSkill(
    args: Scope & { userId: string; skill: string },
  ): Promise<Row<'Skill'>> {
    const skill = args.skill.toLowerCase()
    const filter =
      args.scope === ESkillScope.Personal
        ? { userId: args.userId }
        : { projectId: await this.projectIdOf(args) }
    const row = await db.orm.public.Skill.first({ ...filter, name: skill })
    if (row === null) throw new NotFoundException('skill not found')
    return row
  }

  private async projectIdOf(args: Scope & { userId: string }): Promise<string> {
    if (args.scope !== ESkillScope.Project) throw new BadRequestException(SKILL_OWNER_MISSING)
    if (args.projectId === undefined) throw new BadRequestException(SKILL_OWNER_MISSING)
    await this.projects.read({ userId: args.userId, projectId: args.projectId })
    return args.projectId
  }

  private assertNotBuiltIn(skill: string): void {
    if (isBuiltIn(skill)) {
      throw new BadRequestException(
        `'${skill}' is a built-in skill; it cannot be edited or deleted`,
      )
    }
  }

  private async fillDescription(skill: Row<'Skill'>): Promise<string> {
    if (skill.description !== '') return skill.description
    const entry = await db.orm.public.SkillFile.first({ skillId: skill.id, path: SKILL_ENTRY })
    if (entry === null) return skill.description
    const derived = descriptionOf({
      text: Buffer.from(entry.content).toString('utf8'),
      skill: skill.name,
    })
    if (derived === '') return skill.description
    await db.orm.public.Skill.where({ id: skill.id }).update({ description: derived })
    return derived
  }

  async list(args: Scope & { userId: string }): Promise<SkillSummary[]> {
    const filter =
      args.scope === ESkillScope.Personal
        ? { userId: args.userId }
        : { projectId: await this.projectIdOf(args) }
    const skills = await db.orm.public.Skill.where(filter)
      .orderBy((skill) => skill.name.asc())
      .all()
    const names = skills.map((skill) => skill.name)
    const [files, usage] = await Promise.all([
      db.orm.public.SkillFile.where((file) =>
        file.skillId.in(skills.map((skill) => skill.id)),
      ).all(),
      this.usage.usageFor({
        userId: args.userId,
        scope: args.scope,
        ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
        skillNames: names,
      }),
    ])
    const descriptions = await Promise.all(skills.map((skill) => this.fillDescription(skill)))
    const descriptionById = new Map(skills.map((skill, index) => [skill.id, descriptions[index]]))
    const origin =
      args.scope === ESkillScope.Personal ? ESkillOrigin.Personal : ESkillOrigin.Project
    const rows: SkillSummary[] = skills.map((skill) => {
      const own = files.filter((file) => file.skillId === skill.id)
      return {
        name: skill.name,
        description: descriptionById.get(skill.id) ?? skill.description,
        fileCount: own.length,
        sizeBytes: own.reduce((total, file) => total + file.size, 0),
        updatedAt: skill.updatedAt.toISOString(),
        usage: usage.get(skill.name) ?? { usedCount30d: 0, lastUsedAt: null },
        origin,
        overridesBuiltIn: isBuiltIn(skill.name),
      }
    })
    if (args.scope !== ESkillScope.Personal) return rows
    const ownedNames = new Set(names)
    const builtInRows = builtInSkills()
      .filter((skill) => !ownedNames.has(skill.name))
      .map((skill) => this.builtInSummary({ skill, usage }))
    return [...rows, ...builtInRows]
  }

  private builtInSummary(args: {
    skill: ReturnType<typeof builtInSkills>[number]
    usage: Map<string, SkillUsage>
  }): SkillSummary {
    const { skill } = args
    return {
      name: skill.name,
      description: skill.description,
      fileCount: skill.files.length + 1,
      sizeBytes:
        skill.entry.sizeBytes + skill.files.reduce((total, file) => total + file.sizeBytes, 0),
      updatedAt: skill.updatedAt,
      usage: args.usage.get(skill.name) ?? { usedCount30d: 0, lastUsedAt: null },
      origin: ESkillOrigin.BuiltIn,
      overridesBuiltIn: false,
    }
  }

  async listFiles(args: Scope & { userId: string; skill: string }): Promise<SkillFileMeta[]> {
    if (args.scope === ESkillScope.Personal) {
      const builtInOnly = await this.resolveToBuiltInOnly(args)
      if (builtInOnly !== undefined) return builtInOnly
    }
    const skill = await this.resolveSkill(args)
    const files = await db.orm.public.SkillFile.where({ skillId: skill.id })
      .orderBy((file) => file.path.asc())
      .all()
    return files.map((file) => toMetaDto(file))
  }

  private async resolveToBuiltInOnly(
    args: Scope & { userId: string; skill: string },
  ): Promise<SkillFileMeta[] | undefined> {
    const row = await db.orm.public.Skill.first({
      userId: args.userId,
      name: args.skill.toLowerCase(),
    })
    if (row !== null) return undefined
    const skill = builtInSkill(args.skill)
    if (skill === undefined) return undefined
    return [
      {
        path: skill.entry.path,
        revision: 0,
        contentHash: skill.entry.digest,
        sizeBytes: skill.entry.sizeBytes,
        isText: true,
        updatedAt: skill.updatedAt,
      },
      ...skill.files.map((file) => ({
        path: file.path,
        revision: 0,
        contentHash: file.digest,
        sizeBytes: file.sizeBytes,
        isText: file.isText,
        updatedAt: skill.updatedAt,
      })),
    ]
  }

  async get(
    args: Scope & { userId: string; skill: string; path: string },
  ): Promise<SkillFileContent> {
    assertValidPath(args.path)
    if (args.scope === ESkillScope.Personal) {
      const own = await db.orm.public.Skill.first({
        userId: args.userId,
        name: args.skill.toLowerCase(),
      })
      if (own === null) {
        const builtIn = await this.getBuiltIn(args)
        if (builtIn !== undefined) return builtIn
      }
    }
    const skill = await this.resolveSkill(args)
    const row = await db.orm.public.SkillFile.first({ skillId: skill.id, path: args.path })
    if (row === null) throw new NotFoundException('no such file')
    return { ...toMetaDto(row), content: Buffer.from(row.content).toString('base64') }
  }

  private async getBuiltIn(args: {
    userId: string
    skill: string
    path: string
  }): Promise<SkillFileContent | undefined> {
    const skill = builtInSkill(args.skill)
    if (skill === undefined) return undefined
    const meta =
      args.path === skill.entry.path
        ? {
            path: skill.entry.path,
            revision: 0,
            contentHash: skill.entry.digest,
            sizeBytes: skill.entry.sizeBytes,
            isText: true,
            updatedAt: skill.updatedAt,
          }
        : skill.files
            .filter((file) => file.path === args.path)
            .map((file) => ({
              path: file.path,
              revision: 0,
              contentHash: file.digest,
              sizeBytes: file.sizeBytes,
              isText: file.isText,
              updatedAt: skill.updatedAt,
            }))[0]
    if (meta === undefined) return undefined
    const bytes = await readBuiltInFile({ name: args.skill, path: args.path })
    if (bytes === undefined) return undefined
    return { ...meta, content: Buffer.from(bytes).toString('base64') }
  }

  async put(
    args: Scope & {
      userId: string
      skill: string
      path: string
      content: string
      contentHash: string
      baseRevision?: number | undefined
    },
  ): Promise<{ revision: number }> {
    assertValidPath(args.path)
    const content = decodeContent({ content: args.content, contentHash: args.contentHash })
    const contentHash = args.contentHash.toLowerCase()
    const baseRevision = args.baseRevision ?? 0
    const skill = await this.skillForPut(args)
    const key = { skillId: skill.id, path: args.path }
    const data = {
      contentHash,
      content,
      isText: isTextPath(args.path),
      size: content.byteLength,
    }

    const existing = await db.orm.public.SkillFile.first(key)
    if (existing === null) {
      if (baseRevision !== 0) throw conflictOf({ revision: 0, contentHash: '' })
      await this.createFirstRevision({ key, data })
    } else {
      await this.replaceRevision({ key, baseRevision, data, existing })
    }
    await this.afterFileChange({ skill, changedPath: args.path, removed: false })
    return { revision: baseRevision + 1 }
  }

  async remove(
    args: Scope & { userId: string; skill: string; path: string; baseRevision: number },
  ): Promise<{ removed: true }> {
    assertValidPath(args.path)
    const skill = await this.resolveSkill(args)
    const key = { skillId: skill.id, path: args.path }
    const existing = await db.orm.public.SkillFile.first(key)
    if (existing === null) throw new NotFoundException('no such file')
    if (existing.revision !== args.baseRevision) {
      throw conflictOf({ revision: existing.revision, contentHash: existing.contentHash })
    }
    const count = await db.orm.public.SkillFile.where({
      ...key,
      revision: args.baseRevision,
    }).deleteAndCount()
    if (count === 0) throw await this.currentConflict({ key })
    await this.afterFileChange({ skill, changedPath: args.path, removed: true })
    return { removed: true }
  }

  async removeSkill(args: Scope & { userId: string; skill: string }): Promise<{ removed: number }> {
    const skill = await this.resolveSkill(args)
    const removed = await db.orm.public.SkillFile.where({ skillId: skill.id }).deleteAndCount()
    await db.orm.public.Skill.where({ id: skill.id }).delete()
    return { removed }
  }

  private async skillForPut(
    args: Scope & { userId: string; skill: string },
  ): Promise<Row<'Skill'>> {
    if (!SKILL_NAME_PATTERN.test(args.skill) || args.skill.length > SKILL_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `a skill name must match ${SKILL_NAME_PATTERN.source} and be at most ${SKILL_NAME_MAX_LENGTH} characters`,
      )
    }
    const owner =
      args.scope === ESkillScope.Personal
        ? ({ userId: args.userId } as const)
        : ({ projectId: await this.projectIdOf(args) } as const)
    const existing = await db.orm.public.Skill.first({ ...owner, name: args.skill })
    if (existing !== null) return existing
    this.assertNotBuiltIn(args.skill)
    return this.createSkill({ ...owner, name: args.skill })
  }

  private async createSkill(input: {
    userId?: string
    projectId?: string
    name: string
  }): Promise<Row<'Skill'>> {
    try {
      return await db.orm.public.Skill.create(input)
    } catch (failure) {
      if (!isUniqueViolation(failure)) throw failure
      const constraint = violatedConstraint(failure)
      if (constraint !== 'Skill_userId_name_key' && constraint !== 'Skill_projectId_name_key') {
        throw failure
      }
      const raced = await db.orm.public.Skill.first(input)
      if (raced === null) throw failure
      return raced
    }
  }

  private async createFirstRevision(args: {
    key: { skillId: string; path: string }
    data: { contentHash: string; content: Uint8Array<ArrayBuffer>; isText: boolean; size: number }
  }): Promise<void> {
    try {
      await db.orm.public.SkillFile.create({ ...args.key, revision: 1, ...args.data })
    } catch (failure) {
      if (
        !isUniqueViolation(failure) ||
        violatedConstraint(failure) !== SKILL_FILE_KEY_CONSTRAINT
      ) {
        throw failure
      }
      throw await this.currentConflict({ key: args.key })
    }
  }

  private async replaceRevision(args: {
    key: { skillId: string; path: string }
    baseRevision: number
    data: { contentHash: string; content: Uint8Array<ArrayBuffer>; isText: boolean; size: number }
    existing: { revision: number; contentHash: string }
  }): Promise<void> {
    if (args.existing.revision !== args.baseRevision) {
      throw conflictOf({ revision: args.existing.revision, contentHash: args.existing.contentHash })
    }
    const count = await db.orm.public.SkillFile.where({
      ...args.key,
      revision: args.baseRevision,
    }).updateAndCount({ ...args.data, revision: args.baseRevision + 1 })
    if (count === 0) throw await this.currentConflict({ key: args.key })
  }

  private async currentConflict(args: {
    key: { skillId: string; path: string }
  }): Promise<ConflictException> {
    const current = await db.orm.public.SkillFile.first(args.key)
    return conflictOf({ revision: current?.revision ?? 0, contentHash: current?.contentHash ?? '' })
  }

  private async afterFileChange(args: {
    skill: Row<'Skill'>
    changedPath: string
    removed: boolean
  }): Promise<void> {
    let description = args.skill.description
    if (args.changedPath === SKILL_ENTRY) {
      description = ''
      if (!args.removed) {
        const entry = await db.orm.public.SkillFile.first({
          skillId: args.skill.id,
          path: SKILL_ENTRY,
        })
        if (entry !== null) {
          description = descriptionOf({
            text: Buffer.from(entry.content).toString('utf8'),
            skill: args.skill.name,
          })
        }
      }
    }
    await db.orm.public.Skill.where({ id: args.skill.id }).update({
      description,
      updatedAt: new Date(),
    })
  }
}
