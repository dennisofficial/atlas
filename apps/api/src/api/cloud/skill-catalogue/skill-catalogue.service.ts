import { EDefinitionOrigin } from '@dltech/atlas-core'
import { BUILT_IN_SKILL_SPECS, parseSkillSpec } from '@dltech/atlas-harness/skill-specs'
import { ERepoTreeEntryKind, type SkillCatalogueEntry } from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { EGithubCallSource } from '../github/github-call-log'
import { GithubRepoReads } from '../github/github-repo-reads'
import { ProjectsService } from '../projects/projects.service'
import { UserFilesService } from '../user-files/user-files.service'
import { RepoSkillCache } from './repo-skill-cache'
import { mergeSkills, originated, type OriginatedSkill } from './skill-catalogue.merge'
import { folderSkillOf, repoSkillRoots, userSkillOf } from './skill-catalogue.paths'

const SKILLS_TREE = 'skills'

const entryOf = (args: { text: string; fallbackName: string }): SkillCatalogueEntry | undefined => {
  const parsed = parseSkillSpec(args)
  if (parsed === undefined || !parsed.userInvocable) return undefined
  const { name, summary, argumentHint } = parsed.spec
  return argumentHint === undefined ? { name, summary } : { name, summary, argumentHint }
}

@Injectable()
export class SkillCatalogueService {
  private readonly repoCache = new RepoSkillCache()

  constructor(
    private readonly files: UserFilesService,
    private readonly projects: ProjectsService,
    private readonly reads: GithubRepoReads,
  ) {}

  async list(args: {
    userId: string
    projectId?: string | undefined
  }): Promise<SkillCatalogueEntry[]> {
    const [user, project] = await Promise.all([
      this.userSkills(args.userId),
      args.projectId === undefined
        ? []
        : this.projectSkills({ userId: args.userId, projectId: args.projectId }),
    ])
    const builtIn = BUILT_IN_SKILL_SPECS.map((spec) =>
      originated({
        origin: EDefinitionOrigin.BuiltIn,
        spec: {
          name: spec.name,
          summary: spec.summary,
          ...(spec.argumentHint === undefined ? {} : { argumentHint: spec.argumentHint }),
        },
      }),
    )
    return mergeSkills([...builtIn, ...user, ...project])
  }

  private async userSkills(userId: string): Promise<OriginatedSkill[]> {
    const listed = await this.files.list({ userId, tree: SKILLS_TREE })
    const found = listed.flatMap((file) => {
      const skill = file.tombstonedAt === null ? userSkillOf(file.path) : undefined
      return skill === undefined ? [] : [skill]
    })
    if (found.length === 0) return []
    const contents = await this.files.getMany({
      userId,
      tree: SKILLS_TREE,
      paths: found.map((skill) => skill.path),
    })
    const names = new Map(found.map((skill) => [skill.path, skill.fallbackName]))
    return contents.flatMap((file) => {
      if (file.content === null || file.tombstonedAt !== null) return []
      const text = Buffer.from(file.content, 'base64').toString('utf8')
      const entry = entryOf({ text, fallbackName: names.get(file.path) ?? '' })
      return entry === undefined
        ? []
        : [originated({ origin: EDefinitionOrigin.User, spec: entry })]
    })
  }

  private async projectSkills(args: {
    userId: string
    projectId: string
  }): Promise<OriginatedSkill[]> {
    try {
      const workspace = await this.projects.workspace(args)
      const [owner, repo] = workspace.repo?.split('/') ?? []
      if (owner === undefined || repo === undefined || workspace.githubToken === null) return []
      const skills = await this.repoSkills({
        token: workspace.githubToken,
        owner,
        repo,
        ref: workspace.baseBranch ?? 'HEAD',
      })
      return skills.map((spec) => originated({ origin: EDefinitionOrigin.Project, spec }))
    } catch {
      return []
    }
  }

  private async repoSkills(args: {
    token: string
    owner: string
    repo: string
    ref: string
  }): Promise<readonly SkillCatalogueEntry[]> {
    const source = EGithubCallSource.RepoTree
    const tree = await this.reads.listTreeSnapshot({ source, ...args })
    const key = `${args.owner}/${args.repo}@${tree.sha}`
    const cached = tree.sha === '' ? undefined : this.repoCache.get(key)
    if (cached !== undefined) return cached

    const files = tree.entries.filter((entry) => entry.kind === ERepoTreeEntryKind.File)
    const found = repoSkillRoots.flatMap((root) =>
      files.flatMap((entry) => {
        const skill = folderSkillOf({ path: entry.path, root })
        return skill === undefined ? [] : [{ ...skill, sha: entry.sha }]
      }),
    )
    const parsed = await Promise.all(
      found.map(async (skill) => {
        const text = await this.reads.readBlob({
          source,
          token: args.token,
          owner: args.owner,
          repo: args.repo,
          sha: skill.sha,
        })
        return entryOf({ text, fallbackName: skill.fallbackName })
      }),
    )
    const skills = parsed.flatMap((entry) => (entry === undefined ? [] : [entry]))
    if (tree.sha !== '') this.repoCache.set({ key, skills })
    return skills
  }
}
