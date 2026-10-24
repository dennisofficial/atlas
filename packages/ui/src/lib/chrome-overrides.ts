import ts from 'typescript'

export interface ChromeOverride {
  line: number
  component: string
  token: string
}

export interface ChromeOverridesInput {
  source: string
  fileName: string
  componentSpecifiers: RegExp[]
  exemptComponents?: string[]
}

export const DEFAULT_EXEMPT_COMPONENTS = ['Skeleton']

const CHROME_PATTERNS = [
  /^-?(p|px|py|pt|pr|pb|pl|ps|pe)-/,
  /^gap-/,
  /^(h|size)-(\d|\[)/,
  /^rounded/,
  /^border/,
  /^ring/,
  /^shadow/,
  /^bg-/,
  /^text-\[/,
]

interface ClassFragment {
  text: string
  node: ts.Node
}

export function stripVariantPrefix({ token }: { token: string }): string {
  let depth = 0
  let lastColon = -1
  for (let index = 0; index < token.length; index++) {
    const char = token[index]
    if (char === '[') depth++
    else if (char === ']') depth = Math.max(0, depth - 1)
    else if (char === ':' && depth === 0) lastColon = index
  }
  return token.slice(lastColon + 1)
}

export function chromeTokenOf({ token }: { token: string }): string | null {
  const bare = stripVariantPrefix({ token }).replace(/^!/, '').replace(/!$/, '')
  return CHROME_PATTERNS.some((pattern) => pattern.test(bare)) ? bare : null
}

function localBindings({
  declaration,
  exempt,
}: {
  declaration: ts.ImportDeclaration
  exempt: Set<string>
}): string[] {
  const clause = declaration.importClause
  if (!clause) return []
  const local: string[] = []
  if (clause.name && !exempt.has(clause.name.text)) local.push(clause.name.text)
  const bindings = clause.namedBindings
  if (bindings && ts.isNamespaceImport(bindings)) local.push(bindings.name.text)
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (!exempt.has(imported)) local.push(element.name.text)
    }
  }
  return local
}

function collectComponents({
  sourceFile,
  componentSpecifiers,
  exempt,
}: {
  sourceFile: ts.SourceFile
  componentSpecifiers: RegExp[]
  exempt: Set<string>
}): Set<string> {
  const components = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    if (!componentSpecifiers.some((pattern) => pattern.test(specifier))) continue
    for (const name of localBindings({ declaration: statement, exempt })) {
      components.add(name)
    }
  }
  return components
}

function classFragments({ node }: { node: ts.Node }): ClassFragment[] {
  if (ts.isStringLiteralLike(node)) return [{ text: node.text, node }]
  if (ts.isTemplateExpression(node)) {
    return [
      { text: node.head.text, node: node.head },
      ...node.templateSpans.flatMap((span) => [
        ...classFragments({ node: span.expression }),
        { text: span.literal.text, node: span.literal },
      ]),
    ]
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return classFragments({ node: node.expression })
  }
  if (ts.isConditionalExpression(node)) {
    return [...classFragments({ node: node.whenTrue }), ...classFragments({ node: node.whenFalse })]
  }
  if (ts.isBinaryExpression(node)) {
    return [...classFragments({ node: node.left }), ...classFragments({ node: node.right })]
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => classFragments({ node: element }))
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'cn'
  ) {
    return node.arguments.flatMap((argument) => classFragments({ node: argument }))
  }
  return []
}

function classNameFragments({ attributes }: { attributes: ts.JsxAttributes }): ClassFragment[] {
  const fragments: ClassFragment[] = []
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue
    if (attribute.name.getText() !== 'className') continue
    const initializer = attribute.initializer
    if (!initializer) continue
    if (ts.isStringLiteral(initializer)) {
      fragments.push({ text: initializer.text, node: initializer })
      continue
    }
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      fragments.push(...classFragments({ node: initializer.expression }))
    }
  }
  return fragments
}

function rootTagName({ tagName }: { tagName: ts.JsxTagNameExpression }): string {
  if (ts.isIdentifier(tagName)) return tagName.text
  if (ts.isPropertyAccessExpression(tagName)) {
    return rootTagName({ tagName: tagName.expression as ts.JsxTagNameExpression })
  }
  return ''
}

export function chromeOverridesIn({
  source,
  fileName,
  componentSpecifiers,
  exemptComponents = DEFAULT_EXEMPT_COMPONENTS,
}: ChromeOverridesInput): ChromeOverride[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const components = collectComponents({
    sourceFile,
    componentSpecifiers,
    exempt: new Set(exemptComponents),
  })
  if (components.size === 0) return []

  const found: ChromeOverride[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = rootTagName({ tagName: node.tagName })
      if (components.has(component)) {
        for (const fragment of classNameFragments({ attributes: node.attributes })) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(fragment.node.getStart(sourceFile)).line + 1
          for (const raw of fragment.text.split(/\s+/)) {
            const token = chromeTokenOf({ token: raw })
            if (token) found.push({ line, component: node.tagName.getText(), token })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}
