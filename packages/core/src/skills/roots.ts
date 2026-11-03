import { EDefinitionOrigin } from '../discovery/origin'

export enum ESkillRootFlavour {
  Atlas = '.atlas',
  Agents = '.agents',
  Claude = '.claude',
}

export type SkillRoot = {
  directory: string
  origin: EDefinitionOrigin
  flavour: ESkillRootFlavour
}

export const CLOUD_PROJECT_SKILLS_DIRECTORY_NAME = 'project-skills'

export const cloudProjectRootName = (directoryName: string): string => `project-${directoryName}`

const SEPARATOR = '/'

const FLAVOUR_ORDER: readonly ESkillRootFlavour[] = [
  ESkillRootFlavour.Atlas,
  ESkillRootFlavour.Agents,
  ESkillRootFlavour.Claude,
]

const withoutTrailingSeparator = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.length === 0 ? SEPARATOR : trimmed
}

const under = (args: { directory: string; name: string }): string => {
  const base = withoutTrailingSeparator(args.directory)
  return base === SEPARATOR ? `${SEPARATOR}${args.name}` : `${base}${SEPARATOR}${args.name}`
}

export function skillRootPlan(args: {
  atlasHome: string
  home: string
  cwd: string
  skillsDirectoryName: string
}): readonly SkillRoot[] {
  const named = (directory: string): string => under({ directory, name: args.skillsDirectoryName })

  const userDirectoryOf = (flavour: ESkillRootFlavour): string =>
    flavour === ESkillRootFlavour.Atlas
      ? args.atlasHome
      : under({ directory: args.home, name: flavour })

  // The cloud project root must iterate after the cwd roots: resolveShadowing keeps the first of
  // two same-origin definitions, so placing it earlier would let cloud skills shadow repo skills.
  return [
    ...FLAVOUR_ORDER.map((flavour) => ({
      directory: named(userDirectoryOf(flavour)),
      origin: EDefinitionOrigin.User,
      flavour,
    })),
    ...FLAVOUR_ORDER.map((flavour) => ({
      directory: named(under({ directory: args.cwd, name: flavour })),
      origin: EDefinitionOrigin.Project,
      flavour,
    })),
    {
      directory: under({
        directory: args.atlasHome,
        name: `project-${args.skillsDirectoryName}`,
      }),
      origin: EDefinitionOrigin.Project,
      flavour: ESkillRootFlavour.Atlas,
    },
  ]
}
