export const defaultSkillPath = ({
  metas,
}: {
  metas: readonly { path: string; isText: boolean }[]
}): string | null => {
  if (metas.length === 0) return null
  return (
    metas.find((meta) => meta.path === 'SKILL.md')?.path ??
    metas.find((meta) => meta.isText)?.path ??
    metas[0]?.path ??
    null
  )
}

export const skillPathContains = ({ parent, path }: { parent: string; path: string }): boolean =>
  path === parent || path.startsWith(`${parent}/`)

export const skillFileTargetOf = ({
  basePath,
  value,
}: {
  basePath: string
  value: string
}): string => {
  const clean = value.trim().replace(/^\/+|\/+$/g, '')
  return basePath === '' ? clean : `${basePath}/${clean}`
}

export const skillFilePathProblem = ({
  path,
  takenPaths,
  from,
  folder = false,
}: {
  path: string
  takenPaths: readonly string[]
  from?: string
  folder?: boolean
}): string | null => {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) {
    return 'Enter a relative file path.'
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'Use a path without empty, dot or parent segments.'
  }
  if (from === path) return 'Choose a different name.'
  if (folder && from && skillPathContains({ parent: from, path }))
    return 'A folder cannot move inside itself.'
  const otherPaths = takenPaths.filter(
    (candidate) => !from || !skillPathContains({ parent: from, path: candidate }),
  )
  const destinations = from
    ? takenPaths
        .filter((candidate) => skillPathContains({ parent: from, path: candidate }))
        .map((candidate) => path + candidate.slice(from.length))
    : [path]
  for (const destination of destinations) {
    if (
      otherPaths.some(
        (candidate) =>
          skillPathContains({ parent: destination, path: candidate }) ||
          skillPathContains({ parent: candidate, path: destination }),
      )
    )
      return 'A file or folder already uses this path.'
  }
  return null
}

export const skillRenamePlan = <T extends { path: string }>({
  files,
  from,
  to,
}: {
  files: readonly T[]
  from: string
  to: string
}): { file: T; path: string }[] => {
  const folder = !files.some((file) => file.path === from)
  const problem = skillFilePathProblem({
    path: to,
    takenPaths: files.map((file) => file.path),
    from,
    folder,
  })
  if (problem) throw new Error(problem)
  return files
    .filter((file) => skillPathContains({ parent: from, path: file.path }))
    .map((file) => ({ file, path: to + file.path.slice(from.length) }))
}
