import { dlopen, FFIType, ptr } from 'bun:ffi'

const LIBC = process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6'

const encodeCString = (text: string): Uint8Array => {
  const bytes = new TextEncoder().encode(text)
  const buffer = new Uint8Array(bytes.length + 1)
  buffer.set(bytes)
  return buffer
}

const pointerTable = (strings: readonly Uint8Array[]): BigUint64Array => {
  const table = new BigUint64Array(strings.length + 1)
  strings.forEach((value, index) => {
    table[index] = BigInt(ptr(value))
  })
  return table
}

const envEntries = (): readonly string[] =>
  Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)

export function execInPlace(argv: readonly string[]): void {
  const path = argv[0]
  if (path === undefined) return

  const libc = dlopen(LIBC, {
    execve: {
      args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
      returns: FFIType.int,
    },
  })

  const pathBuffer = encodeCString(path)
  const argTable = pointerTable(argv.map(encodeCString))
  const envTable = pointerTable(envEntries().map(encodeCString))

  libc.symbols.execve(ptr(pathBuffer), ptr(argTable), ptr(envTable))
  libc.close()
}
