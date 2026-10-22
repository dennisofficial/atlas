import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const dependencyMap = z.record(z.string(), z.string())

const lockfileSchema = z.object({
  lockfileVersion: z.literal(3),
  configVersion: z.literal(1),
  packages: z.record(z.string(), z.array(z.unknown())),
})

const lockedPackageSchema = z
  .tuple([
    z.string(),
    z.string(),
    z.object({
      dependencies: dependencyMap.optional(),
      optionalDependencies: dependencyMap.optional(),
    }),
  ])
  .rest(z.unknown())

const exactVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)

export type RuntimePackages = {
  dependencies: Record<string, string>
  lock: {
    lockfileVersion: 3
    configVersion: 1
    workspaces: { '': { dependencies: Record<string, string> } }
    packages: Record<string, unknown[]>
  }
}

// Bun writes bun.lock as JSONC: trailing commas, no comments.
function parseBunLock(text: string): z.infer<typeof lockfileSchema> {
  return lockfileSchema.parse(JSON.parse(text.replace(/,\s*([}\]])/g, '$1')))
}

function resolveLockKey({
  packages,
  name,
  parentKey,
}: {
  packages: Record<string, unknown[]>
  name: string
  parentKey: string
}): string {
  let ancestor = parentKey
  while (ancestor) {
    const nested = `${ancestor}/${name}`
    if (packages[nested]) return nested
    const separator = ancestor.lastIndexOf('/')
    ancestor = separator < 0 ? '' : ancestor.slice(0, separator)
  }
  return name
}

export async function lockedRuntimePackages({
  lockPath,
  roots,
}: {
  lockPath: string
  roots: readonly string[]
}): Promise<RuntimePackages> {
  const { packages } = parseBunLock(await readFile(lockPath, 'utf8'))
  const selected: Record<string, unknown[]> = {}
  const dependencies: Record<string, string> = {}

  function visit({ name, parentKey }: { name: string; parentKey: string }): void {
    const key = resolveLockKey({ packages, name, parentKey })
    const candidate = packages[key]
    if (!candidate)
      throw new Error(`Runtime dependency ${JSON.stringify(name)} is missing from ${lockPath}`)
    if (selected[key]) return
    selected[key] = candidate

    const [id, , manifest] = lockedPackageSchema.parse(candidate)
    if (!parentKey) dependencies[name] = exactVersionSchema.parse(id.slice(id.lastIndexOf('@') + 1))
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      visit({ name: dependency, parentKey: key })
    }
  }

  for (const name of roots) visit({ name, parentKey: '' })

  return {
    dependencies,
    lock: {
      lockfileVersion: 3,
      configVersion: 1,
      workspaces: { '': { dependencies } },
      packages: selected,
    },
  }
}
