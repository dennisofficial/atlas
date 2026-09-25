import { Prisma } from '../../../generated/prisma/client'

// Prisma's documented P2002 meta.target only exists on the classic engine; driver adapters nest
// the constraint under meta.driverAdapterError.cause.constraint.fields and render camelCase
// columns double-quoted ("deliveryId"). Shape observed against @prisma/adapter-pg 7.9.1.
const targetOf = (error: Prisma.PrismaClientKnownRequestError): readonly string[] => {
  const meta = error.meta as
    | {
        target?: unknown
        driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } }
      }
    | undefined
  const legacy = meta?.target
  if (Array.isArray(legacy)) return legacy as string[]
  if (typeof legacy === 'string') return [legacy]
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields
  if (!Array.isArray(fields)) return []
  return fields.map((field) => String(field).replaceAll('"', ''))
}

export const isUniqueViolation = (error: unknown, on: readonly string[]): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2002') return false
  const target = targetOf(error)
  return on.length === target.length && on.every((field) => target.includes(field))
}

export const inconsistentStore = (detail: string): Error =>
  new Error(`unique violation without a stored ${detail} — the work-item store is inconsistent`)
