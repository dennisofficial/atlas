export type PackageManifest = {
  readonly dir: string
  readonly name: string
  readonly exports: readonly string[]
}

export const README_EXEMPT = [] as const

export const specifierOf = (args: { name: string; subpath: string }): string =>
  args.subpath === '.' ? args.name : `${args.name}/${args.subpath.replace(/^\.\//, '')}`

const linesOf = (readme: string): string[] => readme.replace(/\r?\n$/, '').split('\n')

const headingProblems = (args: { readme: string; name: string }): string[] => {
  const heading = `# ${args.name}`
  return linesOf(args.readme)[0] === heading ? [] : [`first line must be "${heading}"`]
}

const entryPointProblems = (args: {
  readme: string
  name: string
  exports: readonly string[]
}): string[] =>
  args.exports.flatMap((subpath) => {
    const specifier = specifierOf({ name: args.name, subpath })
    return args.readme.includes(`\`${specifier}\``)
      ? []
      : [`entry point ${specifier} is not named in backticks`]
  })

export const auditReadme = (args: {
  manifest: PackageManifest
  readme: string | undefined
}): string[] => {
  if (args.readme === undefined) return ['no README.md']
  return [
    ...headingProblems({ readme: args.readme, name: args.manifest.name }),
    ...entryPointProblems({
      readme: args.readme,
      name: args.manifest.name,
      exports: args.manifest.exports,
    }),
  ]
}
