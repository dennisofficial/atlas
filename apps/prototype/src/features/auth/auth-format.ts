export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function formatDeviceCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}` : clean
}
