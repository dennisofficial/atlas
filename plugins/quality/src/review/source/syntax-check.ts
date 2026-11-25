import ts from 'typescript'

export function hasSyntaxErrors(args: { path: string; text: string }): boolean {
  const output = ts.transpileModule(args.text, {
    fileName: args.path,
    compilerOptions: { target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve },
    reportDiagnostics: true,
  })
  return (output.diagnostics ?? []).some(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  )
}

// typescript exposes no public accessor for the parse diagnostics of a created source file
function parseDiagnosticsOf(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] | null {
  const parsed = sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[]
  }
  return parsed.parseDiagnostics ?? null
}

export function hasSyntaxErrorsInFile(args: {
  path: string
  text: string
  sourceFile: ts.SourceFile
}): boolean {
  const diagnostics = parseDiagnosticsOf(args.sourceFile)
  if (diagnostics === null) return hasSyntaxErrors({ path: args.path, text: args.text })
  return diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
}

export function hasSyntaxDiagnostics(args: { path: string; text: string }): boolean {
  return hasSyntaxErrors({ path: args.path, text: args.text })
}
