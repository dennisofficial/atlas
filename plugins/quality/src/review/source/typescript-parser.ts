import { createHash } from 'node:crypto'

import {
  EQualityLanguage,
  EQualityScopeKind,
  oneLine,
  type QualityLineRange,
} from '@dltech/atlas-core'
import ts from 'typescript'

import { readQualityParse, type QualityParseBody } from './parse-cache'
import { hasSyntaxErrorsInFile } from './syntax-check'

export const QUALITY_SOURCE_ADAPTER_VERSION = '1'

export type ParsedDeclaration = {
  kind: EQualityScopeKind
  name: string
  qualifiedName: string
  parentQualifiedName: string | null
  position: number
  start: number
  end: number
  lineRange: QualityLineRange
  structuralHash: string
  memberLabels: readonly string[]
}

export type ParsedSource = {
  path: string
  language: EQualityLanguage
  declarations: readonly ParsedDeclaration[]
  evidenceLabels: readonly string[]
  importStatements: readonly string[]
  structuralHashes: Readonly<Record<string, string>>
}

export type ParsedDocument =
  | { ok: true; source: ParsedSource }
  | { ok: false; invalidSyntax: boolean }

const SCRIPT_KIND_BY_EXTENSION: Readonly<
  Record<string, { kind: ts.ScriptKind; language: EQualityLanguage }>
> = {
  '.ts': { kind: ts.ScriptKind.TS, language: EQualityLanguage.TypeScript },
  '.tsx': { kind: ts.ScriptKind.TSX, language: EQualityLanguage.TypeScript },
  '.mts': { kind: ts.ScriptKind.TS, language: EQualityLanguage.TypeScript },
  '.cts': { kind: ts.ScriptKind.TS, language: EQualityLanguage.TypeScript },
  '.js': { kind: ts.ScriptKind.JS, language: EQualityLanguage.JavaScript },
  '.jsx': { kind: ts.ScriptKind.JSX, language: EQualityLanguage.JavaScript },
  '.mjs': { kind: ts.ScriptKind.JS, language: EQualityLanguage.JavaScript },
  '.cjs': { kind: ts.ScriptKind.JS, language: EQualityLanguage.JavaScript },
}

const DECLARATION_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts'] as const

export function isDeclarationPath(args: { path: string }): boolean {
  const lower = args.path.toLowerCase()
  return DECLARATION_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function scriptKindForPath(args: {
  path: string
}): { kind: ts.ScriptKind; language: EQualityLanguage } | null {
  if (isDeclarationPath({ path: args.path })) return null
  const lower = args.path.toLowerCase()
  for (const [extension, mapping] of Object.entries(SCRIPT_KIND_BY_EXTENSION)) {
    if (lower.endsWith(extension)) return mapping
  }
  return null
}

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function hashScopeText(text: string): string {
  return hashText(text)
}

function structuralTextOf(node: ts.Node, sourceFile: ts.SourceFile, fullText: string): string {
  if (ts.isClassDeclaration(node)) {
    return node.members.map((member) => member.getText(sourceFile)).join('\n')
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    const body = node.body
    if (body !== undefined) {
      return `${node.parameters.map((parameter) => parameter.getText(sourceFile)).join(',')}:${body.getText(sourceFile)}`
    }
  }
  if (ts.isVariableStatement(node)) {
    const initializer = node.declarationList.declarations[0]?.initializer
    if (initializer !== undefined) return structuralTextOf(initializer, sourceFile, fullText)
  }
  return fullText.slice(node.getStart(sourceFile), node.getEnd())
}

function nameOf(node: ts.Node): string | null {
  const named = node as ts.NamedDeclaration
  const name = named.name
  if (name === undefined || !ts.isIdentifier(name)) return null
  return name.text
}

function declarationOf(node: ts.Node): { kind: EQualityScopeKind; name: string } | null {
  if (ts.isClassDeclaration(node)) {
    const name = nameOf(node)
    if (name === null) return null
    return { kind: EQualityScopeKind.Class, name }
  }
  if (ts.isFunctionDeclaration(node)) {
    const name = nameOf(node)
    if (name === null) return null
    return { kind: EQualityScopeKind.Function, name }
  }
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    const name = nameOf(node)
    if (name === null) return null
    return { kind: EQualityScopeKind.Method, name }
  }
  if (ts.isVariableStatement(node)) {
    const first = node.declarationList.declarations[0]
    if (first === undefined || !ts.isIdentifier(first.name)) return null
    const initializer = first.initializer
    if (initializer === undefined) return null
    if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return null
    return { kind: EQualityScopeKind.Function, name: first.name.text }
  }
  return null
}

function parseQualityBody(args: {
  path: string
  text: string
  kind: ts.ScriptKind
  language: EQualityLanguage
}): QualityParseBody {
  const sourceFile = ts.createSourceFile(
    args.path,
    args.text,
    ts.ScriptTarget.ESNext,
    true,
    args.kind,
  )

  const declarations: ParsedDeclaration[] = []
  const nameCounts = new Map<string, number>()
  const visit = (node: ts.Node, parentQualifiedName: string | null): void => {
    const declared = declarationOf(node)
    if (declared === null) {
      ts.forEachChild(node, (child) => visit(child, parentQualifiedName))
      return
    }

    const qualifiedName =
      parentQualifiedName === null ? declared.name : `${parentQualifiedName}.${declared.name}`
    const position = nameCounts.get(qualifiedName) ?? 0
    nameCounts.set(qualifiedName, position + 1)
    const startPosition = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const endPosition = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
    const memberLabels = ts.isClassDeclaration(node)
      ? node.members.flatMap((member) => {
          const name = nameOf(member)
          return name === null ? [] : [name]
        })
      : []
    declarations.push({
      kind: declared.kind,
      name: declared.name,
      qualifiedName,
      parentQualifiedName,
      position,
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      lineRange: { start: startPosition.line + 1, end: endPosition.line + 1 },
      structuralHash: hashText(oneLine(structuralTextOf(node, sourceFile, args.text))),
      memberLabels,
    })

    ts.forEachChild(node, (child) => visit(child, qualifiedName))
  }
  visit(sourceFile, null)

  const evidenceLabels: string[] = []
  const structuralHashes: Record<string, string> = {}
  const importStatements: string[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      importStatements.push(statement.getText(sourceFile))
      continue
    }
    const declared = declarationOf(statement)
    if (declared !== null) {
      evidenceLabels.push(declared.name)
      structuralHashes[declared.name] = hashText(
        oneLine(structuralTextOf(statement, sourceFile, args.text)),
      )
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          evidenceLabels.push(declaration.name.text)
          structuralHashes[declaration.name.text] = hashText(oneLine(statement.getText(sourceFile)))
        }
      }
    }
  }

  return {
    language: args.language,
    declarations,
    evidenceLabels,
    importStatements,
    structuralHashes,
    invalidSyntax: hasSyntaxErrorsInFile({
      path: args.path,
      text: args.text,
      sourceFile,
    }),
  }
}

export function parseQualitySource(args: { path: string; text: string }): ParsedDocument {
  const mapping = scriptKindForPath({ path: args.path })
  if (mapping === null) {
    return { ok: false, invalidSyntax: false }
  }
  const body = readQualityParse({
    text: args.text,
    key: `${mapping.kind}:${hashText(args.text)}`,
    parse: () =>
      parseQualityBody({
        path: args.path,
        text: args.text,
        kind: mapping.kind,
        language: mapping.language,
      }),
  })
  if (body.invalidSyntax) return { ok: false, invalidSyntax: true }
  return {
    ok: true,
    source: {
      path: args.path,
      language: body.language,
      declarations: body.declarations,
      evidenceLabels: body.evidenceLabels,
      importStatements: body.importStatements,
      structuralHashes: body.structuralHashes,
    },
  }
}

export { hasSyntaxDiagnostics } from './syntax-check'
