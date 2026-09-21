export type Where = Record<string, unknown>

export const matchesValue = (value: unknown, condition: unknown): boolean => {
  if (typeof condition === 'object' && condition !== null) {
    const ops = condition as Record<string, unknown>
    if ('in' in ops) return (ops.in as unknown[]).includes(value)
    if ('notIn' in ops) return !(ops.notIn as unknown[]).includes(value)
    if ('contains' in ops) {
      return typeof value === 'string' && value.includes(ops.contains as string)
    }
    const range = ops as { gt?: number; gte?: number; lt?: number; lte?: number }
    const numeric = value as number
    if (range.gt !== undefined && !(numeric > range.gt)) return false
    if (range.gte !== undefined && numeric < range.gte) return false
    if (range.lt !== undefined && !(numeric < range.lt)) return false
    if (range.lte !== undefined && numeric > range.lte) return false
    return true
  }
  return value === condition
}

export const project = <Row>(row: Row, select?: Record<string, boolean>): Row => {
  if (select === undefined) return row
  const picked: Record<string, unknown> = {}
  for (const key of Object.keys(select)) {
    picked[key] = (row as unknown as Where)[key]
  }
  return picked as Row
}

export const sortRows = <Row>(rows: Row[], orderBy: unknown): Row[] => {
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, string>[]
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const [key, direction] = Object.entries(clause)[0] as [string, string]
      const left = (a as unknown as Where)[key] as string | number
      const right = (b as unknown as Where)[key] as string | number
      if (left === right) continue
      const less = left < right
      return (direction === 'desc' ? !less : less) ? -1 : 1
    }
    return 0
  })
}

export const applyUpdate = (row: Record<string, unknown>, data: Where): void => {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null && 'increment' in value) {
      row[key] = (row[key] as number) + (value as { increment: number }).increment
      continue
    }
    row[key] = value
  }
}
