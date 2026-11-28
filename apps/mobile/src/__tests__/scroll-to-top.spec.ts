import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const roots = [
  join(import.meta.dir, '..'),
  join(import.meta.dir, '../../../../packages/ui-native/src'),
]

const SCROLL_VIEWS = ['ScrollView', 'FlatList', 'SectionList']

const isScrollView = (tag: ts.JsxTagNameExpression): boolean => {
  const name = ts.isPropertyAccessExpression(tag) ? tag.name.text : tag.getText()
  return SCROLL_VIEWS.includes(name)
}

const optsOut = (attributes: ts.JsxAttributes): boolean =>
  attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText() === 'scrollsToTop' &&
      attribute.initializer !== undefined &&
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
  )

const scrollViewsThatScrollToTop = ({ path, source }: { path: string; source: string }) => {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isScrollView(node.tagName) &&
      !optsOut(node.attributes)
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart())
      found.push(`${path}:${line + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

const sources = (): { path: string; source: string }[] =>
  roots.flatMap((root) =>
    [...new Bun.Glob('**/*.tsx').scanSync({ cwd: root })]
      .filter((file) => !file.includes('__tests__'))
      .map((file) => ({ path: file, source: readFileSync(join(root, file), 'utf8') })),
  )

describe('scroll to top', () => {
  it('is off on every scroll view, because iOS 27 fires it on any tap on the native bar', () => {
    expect(sources().flatMap(scrollViewsThatScrollToTop)).toEqual([])
  })

  it('finds a scroll view that leaves it on', () => {
    const source = 'const A = () => <ScrollView horizontal><Text /></ScrollView>'

    expect(scrollViewsThatScrollToTop({ path: 'a.tsx', source })).toEqual(['a.tsx:1'])
  })

  it('accepts a scroll view that turns it off', () => {
    const source = 'const A = () => <Animated.FlatList scrollsToTop={false} data={[]} />'

    expect(scrollViewsThatScrollToTop({ path: 'a.tsx', source })).toEqual([])
  })
})
