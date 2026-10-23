const REF = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g
const INPUT_REF = /\$\{input:[^}]*\}/

export function hasInputRef(value: string): boolean {
  return INPUT_REF.test(value)
}

export function rewriteRefs(value: string): { value: string; refs: string[] } {
  const refs: string[] = []
  const rewritten = value.replace(REF, (_match, name: string) => {
    refs.push(name)
    return `\${${name}}`
  })
  return { value: rewritten, refs }
}

export function hasRef(value: string): boolean {
  return /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)
}
