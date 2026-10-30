export enum EServiceReferenceField {
  Url = 'url',
  PublicUrl = 'publicUrl',
  Port = 'port',
}

export type ServiceReference = {
  target: string
  field: EServiceReferenceField
}

export type ServiceReferenceProblem = { name: string; detail: string }

export type ServiceOrderResult =
  | { ok: true; order: string[] }
  | { ok: false; problems: ServiceReferenceProblem[] }

export type ResolvedServiceReference = {
  url: string
  publicUrl?: string | undefined
  port: number
}

type OrderableService = {
  name: string
  env?: Readonly<Record<string, string>> | undefined
  portal?: unknown
}

const REFERENCE_SOURCE = String.raw`\$\{services\.([a-z0-9][a-z0-9-]{0,31})\.(url|publicUrl|port)\}`

export function serviceReferencesOf(
  env: Readonly<Record<string, string>> | undefined,
): ServiceReference[] {
  const references: ServiceReference[] = []
  for (const value of Object.values(env ?? {})) {
    for (const match of value.matchAll(new RegExp(REFERENCE_SOURCE, 'g'))) {
      const [, target, field] = match
      if (target === undefined || field === undefined) continue
      references.push({ target, field: field as EServiceReferenceField })
    }
  }
  return references
}

function closureOf({
  services,
  wanted,
}: {
  services: readonly OrderableService[]
  wanted: readonly string[] | undefined
}): Set<string> {
  const byName = new Map(services.map((service) => [service.name, service]))
  const closure = new Set<string>()
  const pending = wanted === undefined ? services.map((service) => service.name) : [...wanted]
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (closure.has(name)) continue
    closure.add(name)
    for (const { target } of serviceReferencesOf(byName.get(name)?.env)) pending.push(target)
  }
  return closure
}

export function orderDeclaredServices({
  services,
  wanted,
}: {
  services: readonly OrderableService[]
  wanted?: readonly string[] | undefined
}): ServiceOrderResult {
  const byName = new Map(services.map((service) => [service.name, service]))
  const closure = closureOf({ services, wanted })
  const problems: ServiceReferenceProblem[] = []
  const order: string[] = []
  const done = new Set<string>()
  const stack: string[] = []
  const cyclic = new Set<string>()

  const visit = (name: string): void => {
    if (done.has(name)) return
    const at = stack.indexOf(name)
    if (at !== -1) {
      const members = stack.slice(at)
      if (!members.some((member) => cyclic.has(member))) {
        problems.push({
          name,
          detail: `dependency cycle: ${[...members, name].join(' -> ')}`,
        })
      }
      for (const member of members) cyclic.add(member)
      return
    }
    const service = byName.get(name)
    if (service === undefined) return
    stack.push(name)
    const seen = new Set<string>()
    for (const { target, field } of serviceReferencesOf(service.env)) {
      const targetService = byName.get(target)
      if (targetService === undefined) {
        if (!seen.has(`missing:${target}`)) {
          problems.push({
            name,
            detail: `references undeclared service "${target}"`,
          })
        }
        seen.add(`missing:${target}`)
        continue
      }
      if (field === EServiceReferenceField.PublicUrl && targetService.portal === undefined) {
        if (!seen.has(`portal:${target}`)) {
          problems.push({
            name,
            detail: `uses publicUrl of "${target}", which declares no portal`,
          })
        }
        seen.add(`portal:${target}`)
      }
    }
    const dependencies = [...new Set(serviceReferencesOf(service.env).map(({ target }) => target))]
    for (const target of services
      .map((item) => item.name)
      .filter((item) => dependencies.includes(item))) {
      visit(target)
    }
    stack.pop()
    done.add(name)
    order.push(name)
  }

  for (const service of services) {
    if (closure.has(service.name)) visit(service.name)
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, order }
}

export function interpolateServiceEnv({
  env,
  resolved,
}: {
  env: Readonly<Record<string, string>>
  resolved: Readonly<Record<string, ResolvedServiceReference>>
}): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(
      new RegExp(REFERENCE_SOURCE, 'g'),
      (whole, target: string, field: string) => {
        const entry = resolved[target]
        if (entry === undefined) return whole
        const replacement = entry[field as EServiceReferenceField]
        return replacement === undefined ? whole : String(replacement)
      },
    )
  }
  return result
}

export function internalServiceUrl({ port }: { port: number }): string {
  return `http://127.0.0.1:${port}`
}
