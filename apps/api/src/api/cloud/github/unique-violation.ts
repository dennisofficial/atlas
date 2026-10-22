import { violatedConstraint } from '@dltech/atlas-db'

export const isUniqueViolation = ({ error, constraint }: { error: unknown; constraint: string }): boolean =>
  violatedConstraint(error) === constraint

export const inconsistentStore = (detail: string): Error =>
  new Error(`unique violation without a stored ${detail} — the work-item store is inconsistent`)
