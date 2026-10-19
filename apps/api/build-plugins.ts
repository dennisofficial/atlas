/// <reference types="bun" />
import { builtinModules } from 'node:module'

const BETTER_AUTH_DIST = /@thallesp\/nestjs-better-auth\/dist\/index\.mjs$/

const EXPRESS_REQUIRE_SOURCE = `function getExpressBodyParser() {
  return require$1("express");
}`

const EXPRESS_BUNDLED_SOURCE = `function getExpressBodyParser() {
  return bundledExpress;
}`

const BUNDLED_EXPRESS_IMPORT = `import bundledExpress from 'express';\n`

// @thallesp/nestjs-better-auth 2.8.0 loads express via createRequire(), which Bun.build cannot see; at runtime Bun then auto-installs it into ~/.bun/install/cache, which is read-only on Vercel.
export function bundleBetterAuthExpress(): Bun.BunPlugin {
  return {
    name: 'bundle-better-auth-express',
    setup(build) {
      build.onLoad({ filter: BETTER_AUTH_DIST }, async ({ path }) => {
        const source = await Bun.file(path).text()
        if (!source.includes(EXPRESS_REQUIRE_SOURCE)) {
          throw new Error(
            `bundle-better-auth-express: expected ${JSON.stringify(EXPRESS_REQUIRE_SOURCE)} in ${path}; ` +
              'the library changed, so re-check how it loads express before shipping the bundle.',
          )
        }
        return {
          loader: 'js',
          contents: BUNDLED_EXPRESS_IMPORT + source.replace(EXPRESS_REQUIRE_SOURCE, EXPRESS_BUNDLED_SOURCE),
        }
      })
    },
  }
}

const NODE_BUILTINS = new Set(builtinModules)

function isBarePackageName(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return false
  return !NODE_BUILTINS.has(specifier)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findRuntimeRequires({ bundle }: { bundle: string }): string[] {
  const requireNames = [...bundle.matchAll(/([\w$]+)\s*=\s*createRequire\w*\(/g)].map((match) => match[1] ?? '')
  const callers = [...requireNames.map(escapeRegExp), 'createRequire\\w*\\([^)]*\\)']
  const call = new RegExp(`(?:${callers.join('|')})\\(\\s*["']([^"']+)["']\\s*\\)`, 'g')
  const specifiers = [...bundle.matchAll(call)].map((match) => match[1] ?? '')
  return [...new Set(specifiers.filter(isBarePackageName))]
}

export function assertNoRuntimeRequires({
  bundle,
  allowed,
}: {
  bundle: string
  allowed: readonly string[]
}): void {
  const escapes = findRuntimeRequires({ bundle }).filter((specifier) => !allowed.includes(specifier))
  if (escapes.length === 0) return
  throw new Error(
    `The bundle still requires ${escapes.map((specifier) => JSON.stringify(specifier)).join(', ')} at runtime ` +
      'through createRequire(), which Bun.build cannot bundle; on Vercel the missing package would be auto-installed onto a read-only filesystem.',
  )
}
