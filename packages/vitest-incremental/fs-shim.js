// Vitest's module runner imports builtins natively without asking plugins to
// resolve them, so `fs` specifiers in repo modules are rewritten to real shim files.
import { fileURLToPath } from 'node:url';

const SHIM_DIR = fileURLToPath(new URL('./shims/', import.meta.url));
const FS_SHIM = `${SHIM_DIR}fs.js`;
const PROMISES_SHIM = `${SHIM_DIR}fs-promises.js`;

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(node:)?fs(\/promises)?\2/g;

/** @param {string} id */
function shimmable(id) {
  const path = id.split('?')[0] ?? '';
  return (
    /\.[cm]?[jt]sx?$/.test(path) &&
    !path.includes('/node_modules/') &&
    !path.startsWith(SHIM_DIR) &&
    !path.startsWith('\0')
  );
}

/** @param {string} code @param {string} id */
export function rewriteFsImports(code, id) {
  if (!shimmable(id) || !/['"](node:)?fs(\/promises)?['"]/.test(code)) return undefined;
  let changed = false;
  const out = code.replace(SPECIFIER, (_match, lead, quote, _node, promises) => {
    changed = true;
    return `${lead}${quote}${promises ? PROMISES_SHIM : FS_SHIM}${quote}`;
  });
  return changed ? out : undefined;
}
