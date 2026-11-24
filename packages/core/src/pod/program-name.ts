const SEGMENT_SPLIT = /&&|\|\||;|\||\n/
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const SETUP_COMMANDS = new Set(['cd', 'export', 'source', '.', 'set', 'pushd'])
const WRAPPERS = new Set(['bunx', 'npx', 'pnpx', 'env', 'nice', 'time', 'exec', 'sudo', 'nohup'])
const TOOLS_WITH_SUBCOMMAND = new Set([
  'bun',
  'npm',
  'pnpm',
  'yarn',
  'git',
  'turbo',
  'docker',
  'cargo',
  'go',
  'gh',
])

const isFlag = (token: string): boolean => token.startsWith('-')

const basenameOf = (token: string): string => token.slice(token.lastIndexOf('/') + 1)

const tokensOf = (segment: string): string[] =>
  segment
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)

const withoutPrefixes = (tokens: readonly string[]): string[] => {
  const rest = [...tokens]
  for (;;) {
    const head = rest[0]
    if (head === undefined) return rest
    if (ENV_ASSIGNMENT.test(head) || WRAPPERS.has(basenameOf(head))) {
      rest.shift()
      continue
    }
    if (basenameOf(head) === 'timeout') {
      rest.shift()
      while (rest[0] !== undefined && (isFlag(rest[0]) || /^\d/.test(rest[0]))) rest.shift()
      continue
    }
    return rest
  }
}

const nameOfTokens = (tokens: readonly string[]): string | undefined => {
  const [head, ...rest] = withoutPrefixes(tokens)
  if (head === undefined) return undefined
  const program = basenameOf(head)
  if (!TOOLS_WITH_SUBCOMMAND.has(program)) return program
  const subcommand = rest.find((token) => !isFlag(token))
  return subcommand === undefined ? program : `${program} ${subcommand}`
}

export const programNameOf = (command: string): string => {
  const segments = command.split(SEGMENT_SPLIT).map(tokensOf)
  const work = segments.filter((tokens) => {
    const head = tokens[0]
    return head !== undefined && !SETUP_COMMANDS.has(head)
  })
  for (const tokens of work) {
    const name = nameOfTokens(tokens)
    if (name !== undefined) return name
  }
  return command.trim()
}
