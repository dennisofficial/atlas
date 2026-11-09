import {
  declarationHash,
  serviceDeclarationSchema,
  serviceNameSchema,
  servicesFileSchema,
  type ServiceDeclaration,
} from '@dltech/atlas-core'

export const DECLARED_SERVICES_FILE = ['.atlas', 'services.yaml'] as const

export type DeclaredServices = {
  services: ReadonlyMap<string, ServiceDeclaration>
  hashes: ReadonlyMap<string, string>
}

export type DeclaredRead = { ok: true; value: DeclaredServices } | { ok: false; reason: string }

export type DeclaredOrder = { ok: true; order: readonly string[] } | { ok: false; reason: string }

const MAX_REPORTED_ISSUES = 5

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const issuesOf = (issues: readonly { path: readonly PropertyKey[]; message: string }[]): string =>
  issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const field = issue.path.map(String).join('.')
      return field === '' ? issue.message : `${field}: ${issue.message}`
    })
    .join('; ')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const declaredNames = (services: ReadonlyMap<string, ServiceDeclaration>): string =>
  services.size === 0 ? 'none' : [...services.keys()].sort().join(', ')

export const declaredServicesOf = (content: string): DeclaredRead => {
  let document: unknown
  try {
    document = Bun.YAML.parse(content)
  } catch (error) {
    return { ok: false, reason: `is not valid YAML: ${messageOf(error)}` }
  }
  if (!isRecord(document) || document.services === undefined) {
    return { ok: false, reason: 'has no services key' }
  }
  const shape = servicesFileSchema.safeParse(document)
  if (!shape.success) return { ok: false, reason: `is malformed: ${issuesOf(shape.error.issues)}` }

  const services = new Map<string, ServiceDeclaration>()
  const hashes = new Map<string, string>()
  for (const [name, raw] of Object.entries(shape.data.services)) {
    if (!serviceNameSchema.safeParse(name).success) {
      return {
        ok: false,
        reason: `declares "${name}", which is not a service name: lowercase letters, digits and dashes, at most 32 characters`,
      }
    }
    const entry = serviceDeclarationSchema.safeParse(raw)
    if (!entry.success) {
      return { ok: false, reason: `declares "${name}" badly: ${issuesOf(entry.error.issues)}` }
    }
    services.set(name, entry.data)
    hashes.set(name, declarationHash(entry.data))
  }
  return { ok: true, value: { services, hashes } }
}

const unknownName = (args: { name: string; declared: DeclaredServices }): string =>
  `"${args.name}" is not declared in .atlas/services.yaml; declared services: ${declaredNames(args.declared.services)}`

export const declaredOrder = (args: {
  declared: DeclaredServices
  name: string
}): DeclaredOrder => {
  const { services } = args.declared
  if (!services.has(args.name)) return { ok: false, reason: unknownName(args) }

  const order: string[] = []
  const done = new Set<string>()
  const visit = (name: string, chain: readonly string[]): string | undefined => {
    if (done.has(name)) return undefined
    const at = chain.indexOf(name)
    if (at !== -1) {
      return `services need each other in a cycle: ${[...chain.slice(at), name].join(' -> ')}`
    }
    const declaration = services.get(name)
    if (declaration === undefined) return unknownName({ name, declared: args.declared })
    for (const need of declaration.needs ?? []) {
      const problem = visit(need, [...chain, name])
      if (problem !== undefined) return problem
    }
    done.add(name)
    order.push(name)
    return undefined
  }
  const problem = visit(args.name, [])
  return problem === undefined ? { ok: true, order } : { ok: false, reason: problem }
}
