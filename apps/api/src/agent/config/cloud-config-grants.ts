import { ACCESS_GRANT_INSTRUCTION_MAX, ACCESS_GRANT_NAME_MAX } from '@dltech/atlas-wire/web'

export type GrantFile = { path: string; mode: number }

export type GrantView = {
  name: string
  instruction: string
  secrets: readonly string[]
  files: readonly GrantFile[]
}

export type GrantWrite = {
  name: string
  instruction?: string | undefined
  newName?: string | undefined
}

export const grantNameProblem = (name: string): string | undefined => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'name is required for a grant'
  return trimmed.length > ACCESS_GRANT_NAME_MAX
    ? `a grant name holds at most ${ACCESS_GRANT_NAME_MAX} characters`
    : undefined
}

export const grantInstructionProblem = (instruction: string): string | undefined =>
  instruction.length > ACCESS_GRANT_INSTRUCTION_MAX
    ? `a grant instruction holds at most ${ACCESS_GRANT_INSTRUCTION_MAX} characters`
    : undefined

export const noGrantNamed = (name: string): string =>
  `no grant named ${name}; create it with kind grant`

export const grantRequired = (member: 'secret' | 'file'): string =>
  `name the grant this ${member} belongs to (grant: ...)`

export const grantUpdateOf = (args: {
  existing: { name: string; instruction: string }
  instruction: string | undefined
  newName: string | undefined
}): { name: string; instruction?: string } => {
  const name = args.newName === undefined ? args.existing.name : args.newName.trim()
  const problem = grantNameProblem(name)
  if (problem !== undefined) throw new Error(problem)
  return {
    name,
    ...(args.instruction === undefined ? {} : { instruction: args.instruction }),
  }
}

const byPath = (left: GrantFile, right: GrantFile): number => left.path.localeCompare(right.path)

export const grantViewOf = (args: {
  grant: { id: string; name: string; instruction: string }
  secrets: readonly { name: string; grantId: string }[]
  files: readonly { path: string; mode: number; grantId: string }[]
}): GrantView => ({
  name: args.grant.name,
  instruction: args.grant.instruction,
  secrets: args.secrets
    .filter((secret) => secret.grantId === args.grant.id)
    .map((secret) => secret.name)
    .sort(),
  files: args.files
    .filter((file) => file.grantId === args.grant.id)
    .map((file) => ({ path: file.path, mode: file.mode }))
    .sort(byPath),
})
