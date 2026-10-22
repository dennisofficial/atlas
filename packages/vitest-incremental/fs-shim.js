// Vitest's module runner imports builtins natively without asking plugins to
// resolve them, so `fs` specifiers in repo modules are rewritten to real shim files.
// Runs after TypeScript is stripped, so es-module-lexer sees plain JavaScript and
// only real import specifiers are touched, never string literals.
import { fileURLToPath } from 'node:url'
import { init, parse } from 'es-module-lexer'

const SHIM_DIR = fileURLToPath(new URL('./shims/', import.meta.url))
const SHIMS = new Map([
  ['fs', `${SHIM_DIR}fs.js`],
  ['node:fs', `${SHIM_DIR}fs.js`],
  ['fs/promises', `${SHIM_DIR}fs-promises.js`],
  ['node:fs/promises', `${SHIM_DIR}fs-promises.js`],
])

/** @param {string} id */
function shimmable(id) {
  const path = id.split('?')[0] ?? ''
  return (
    /\.[cm]?[jt]sx?$/.test(path) &&
    !path.includes('/node_modules/') &&
    !path.startsWith(SHIM_DIR) &&
    !path.startsWith('\0')
  )
}

/** @param {string} code @param {string} id */
export async function rewriteFsImports(code, id) {
  if (!shimmable(id) || !/['"](node:)?fs(\/promises)?['"]/.test(code)) return undefined
  await init
  let imports
  try {
    ;[imports] = parse(code)
  } catch {
    return undefined
  }
  let out = ''
  let last = 0
  for (const entry of imports) {
    const shim = entry.n === undefined ? undefined : SHIMS.get(entry.n)
    if (shim === undefined || entry.s < 0) continue
    const quoted = entry.d > -1
    const start = quoted ? entry.s + 1 : entry.s
    const end = quoted ? entry.e - 1 : entry.e
    if (code.slice(start, end) !== entry.n) continue
    out += code.slice(last, start) + shim
    last = end
  }
  if (last === 0) return undefined
  return out + code.slice(last)
}
