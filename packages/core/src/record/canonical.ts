const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const canonicalArray = (items: readonly unknown[]): string =>
  `[${items.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`

const canonicalObject = (value: object): string => {
  if (!isPlainObject(value)) throw new TypeError('canonicalJson: non-plain object')
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
  return `{${members.join(',')}}`
}

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return canonicalArray(value)
  if (typeof value === 'object') return canonicalObject(value)
  throw new TypeError(`canonicalJson: unsupported ${typeof value}`)
}
