export function formatDeviceCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}` : clean
}
