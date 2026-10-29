import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  serviceDeclarationSchema,
  serviceNameSchema,
  servicesFileSchema,
  type ServiceDeclaration,
} from '@dltech/atlas-core'

export const SERVICES_FILE_PATH = ['.atlas', 'services.yaml'] as const

export enum EServiceRejection {
  Unreadable = 'unreadable',
  NotYaml = 'not-yaml',
  BadShape = 'bad-shape',
  BadName = 'bad-name',
  BadEntry = 'bad-entry',
}

export type ServiceRejection = {
  rejection: EServiceRejection
  name: string | undefined
  definedIn: string
  detail: string
}

export type DeclaredService = ServiceDeclaration & { name: string }

export type DeclaredServicesRead = {
  services: readonly DeclaredService[]
  rejections: readonly ServiceRejection[]
}

export type ServicesTextReader = (file: string) => Promise<string>

const MAX_REPORTED_ISSUES = 5

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isAbsent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const formatIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string =>
  issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const field = issue.path.map(String).join('.')
      return field === '' ? issue.message : `${field}: ${issue.message}`
    })
    .join('; ')

export function servicesFileOf({ root }: { root: string }): string {
  return join(root, ...SERVICES_FILE_PATH)
}

export function parseDeclaredServices({
  text,
  file,
}: {
  text: string
  file: string
}): DeclaredServicesRead {
  const rejections: ServiceRejection[] = []
  const reject = (rejection: Omit<ServiceRejection, 'definedIn'>): void => {
    rejections.push({ ...rejection, definedIn: file })
  }

  let document: unknown
  try {
    document = Bun.YAML.parse(text)
  } catch (error) {
    reject({ rejection: EServiceRejection.NotYaml, name: undefined, detail: detailOf(error) })
    return { services: [], rejections }
  }

  const shape = servicesFileSchema.safeParse(document)
  if (!shape.success) {
    reject({
      rejection: EServiceRejection.BadShape,
      name: undefined,
      detail: formatIssues(shape.error.issues),
    })
    return { services: [], rejections }
  }

  const services: DeclaredService[] = []
  for (const [name, raw] of Object.entries(shape.data.services)) {
    if (!serviceNameSchema.safeParse(name).success) {
      reject({
        rejection: EServiceRejection.BadName,
        name,
        detail: 'names are lowercase letters, digits and dashes, at most 32 characters',
      })
      continue
    }

    const entry = serviceDeclarationSchema.safeParse(raw)
    if (entry.success) services.push({ ...entry.data, name })
    else {
      reject({
        rejection: EServiceRejection.BadEntry,
        name,
        detail: formatIssues(entry.error.issues),
      })
    }
  }

  return { services, rejections }
}

export async function loadDeclaredServices({
  root,
  read = (file) => readFile(file, 'utf8'),
}: {
  root: string
  read?: ServicesTextReader
}): Promise<DeclaredServicesRead> {
  const file = servicesFileOf({ root })
  let text: string
  try {
    text = await read(file)
  } catch (error) {
    if (isAbsent(error)) return { services: [], rejections: [] }
    return {
      services: [],
      rejections: [
        {
          rejection: EServiceRejection.Unreadable,
          name: undefined,
          definedIn: file,
          detail: detailOf(error),
        },
      ],
    }
  }

  return parseDeclaredServices({ text, file })
}
