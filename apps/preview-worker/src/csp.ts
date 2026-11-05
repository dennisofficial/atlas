export enum ECspDirective {
  FrameAncestors = 'frame-ancestors',
  ScriptSrcElem = 'script-src-elem',
  ScriptSrc = 'script-src',
  DefaultSrc = 'default-src',
}

const INLINE_SCRIPT_DIRECTIVES = [
  ECspDirective.ScriptSrcElem,
  ECspDirective.ScriptSrc,
  ECspDirective.DefaultSrc,
]

const NONCE_OR_HASH = /^'(nonce|sha256|sha384|sha512)-/i

function nameOf(directive: string): string {
  return directive.split(/\s+/)[0]?.toLowerCase() ?? ''
}

function allowHashIn(args: { directive: string; hash: string }): string {
  const { directive, hash } = args
  const [name = '', ...values] = directive.split(/\s+/)
  const lowered = values.map((value) => value.toLowerCase())
  const guarded = values.some((value) => NONCE_OR_HASH.test(value))
  if (lowered.includes("'unsafe-inline'") && !guarded) return directive
  const kept = values.filter((value) => value.toLowerCase() !== "'none'")
  return [name, ...kept, hash].join(' ')
}

function editPolicy(args: { policy: string; scriptHash: string | null }): string {
  const { policy, scriptHash } = args
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .filter((directive) => nameOf(directive) !== ECspDirective.FrameAncestors)
  const target = INLINE_SCRIPT_DIRECTIVES.find((name) =>
    directives.some((directive) => nameOf(directive) === name),
  )
  if (scriptHash === null || target === undefined) return directives.join('; ')
  return directives
    .map((directive) =>
      nameOf(directive) === target ? allowHashIn({ directive, hash: scriptHash }) : directive,
    )
    .join('; ')
}

export function editCsp(args: { header: string; scriptHash: string | null }): string | null {
  const { header, scriptHash } = args
  const policies = header
    .split(',')
    .map((policy) => editPolicy({ policy, scriptHash }))
    .filter((policy) => policy.length > 0)
  return policies.length === 0 ? null : policies.join(', ')
}
