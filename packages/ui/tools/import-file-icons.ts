import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type CustomPlugin, optimize, type XastParent } from 'svgo'
import { EIconPart, type IconArt, type IconPath } from '../src/file-icons/types'

const fileSources = `
TypeScript:typeScript TypeScriptTest:testts React:jsx ReactTest:testreact JavaScript:js JavaScriptTest:testjs Declaration:dts
Json:json Markdown:markdown Mdx:mdx Yaml:yaml Toml:toml Xml:xml Html:html Css:css Scss:scss Sass:sass Less:less
Svg:svg Image:image Python:python Go:go Rust:rust Java:java Kotlin:kotlin Swift:swift Ruby:ruby Php:php C:c Cpp:cpp CSharp:csharp
Shell:shell PowerShell:powershell Sql:sql Prisma:prisma Graphql:graphql Protobuf:protobuf Terraform:terraform Nix:nix Lua:lua
Dart:dart Elixir:ex Zig:zig WebAssembly:webassembly Pdf:pdf Text:text Log:log Csv:csv Archive:archive Font:font Video:video Audio:audio
Docker:docker DockerCompose:dockercompose DockerIgnore:dockerignore Git:git GitIgnore:gitignore Npm:npm NpmLock:npmlock
Bun:bun BunLock:bunlock YarnLock:yarnlock Pnpm:pnpm Lock:lock Tsconfig:tsconfig Eslint:eslintconfig Prettier:prettier Biome:biome
Vite:vite Vitest:vitest Storybook:storybook Nextjs:nextjs Tailwind:tailwindcss Environment:envs Key:key Certificate:certificate
License:license Readme:readme Changelog:changelog Contributing:githubContributing Agents:agents Claude:claude Makefile:makefile
Editorconfig:editorconfig NodeVersion:nodeversion Vercel:vercel Turbo:turborepo Renovate:renovate Vue:vue Svelte:svelte Astro:astro Ini:source File:file
`
const folderSources = `
FolderSource:src FolderTests:tests FolderDocs:docs FolderApp:app FolderApi:api FolderComponents:components FolderHooks:hook
FolderLib:lib FolderTools:tools FolderScripts:scripts FolderConfig:config FolderGithub:github FolderGit:git FolderPackages:packages
FolderPlugins:plugin FolderWeb:web FolderImages:images FolderStyles:styles FolderThemes:themes FolderFixtures:fixtures FolderDb:db
FolderPrisma:prisma FolderDocker:docker FolderEnv:env FolderKeys:keys FolderI18n:i18n FolderMobile:mobile FolderServer:server
FolderDist:dist FolderNode:node FolderCi:circleci FolderVscode:vscode FolderIdea:project Folder:folder
`
const attribution =
  '// https://github.com/mallowigi/iconGenerator — MIT, Copyright (c) 2015-2024 Elior "Mallowigi" Boukhobza\n'
const destination = resolve(import.meta.dir, '../src/file-icons')

function sourceEntries(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const [member, source] = entry.split(':')
      if (!member || !source) throw new Error(`Invalid source: ${entry}`)
      const value = member
        .replace(/TypeScript/g, 'Typescript')
        .replace(/JavaScript/g, 'Javascript')
        .replace(/PowerShell/g, 'Powershell')
        .replace(/WebAssembly/g, 'Webassembly')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
      return { member, source, value }
    })
}

function foregroundFill(fill: string): string | null {
  if (/^#[\da-f]{3}$/i.test(fill))
    fill = `#${[...fill.slice(1)].map((digit) => digit + digit).join('')}`
  if (!/^#[\da-f]{6}$/i.test(fill)) throw new Error(`Unsupported fill: ${fill}`)
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(fill.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance =
    (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
  return luminance < 0.12 || luminance > 0.9 ? null : fill.toLowerCase()
}

function inheritPaint(defaultPart: EIconPart): CustomPlugin {
  const inherited = new WeakMap<XastParent, Record<string, string>>()
  return {
    name: 'inherit-paint',
    fn: () => ({
      element: {
        enter: (node, parent) => {
          const attrs = { ...inherited.get(parent), ...node.attributes }
          inherited.set(node, attrs)
          if (
            !['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'].includes(
              node.name,
            )
          )
            return
          node.attributes.fill = attrs.fill ?? '#000000'
          node.attributes['fill-rule'] = attrs['fill-rule'] ?? 'nonzero'
          node.attributes['data-part'] = attrs['data-folderColor'] ? EIconPart.Body : defaultPart
        },
      },
    }),
  }
}

async function importArt(path: string): Promise<IconArt> {
  const paths: IconPath[] = []
  let viewBox = ''
  const collect: CustomPlugin = {
    name: 'collect-paths',
    fn: () => ({
      element: {
        enter: (node, parent) => {
          const attrs = node.attributes
          if (!['svg', 'g', 'path'].includes(node.name))
            throw new Error(`${path}: unsupported ${node.name}`)
          for (const key of [
            'transform',
            'mask',
            'filter',
            'clip-path',
            'opacity',
            'fill-opacity',
            'stroke-opacity',
            'style',
          ]) {
            if (attrs[key] !== undefined) throw new Error(`${path}: unsupported ${key}`)
          }
          if (attrs.stroke && attrs.stroke !== 'none') throw new Error(`${path}: stroke geometry`)
          if (node.name === 'svg') viewBox = attrs.viewBox ?? ''
          if (node.name !== 'path') return
          if (!attrs.d) throw new Error(`${path}: missing path`)
          const fill =
            attrs.fill ??
            (parent.type === 'element' ? parent.attributes.fill : undefined) ??
            '#000000'
          paths.push({
            d: attrs.d,
            fill: foregroundFill(fill),
            part: attrs['data-part'] === EIconPart.Body ? EIconPart.Body : EIconPart.Glyph,
            ...(attrs['fill-rule'] === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
          })
        },
      },
    }),
  }
  optimize(await readFile(path, 'utf8'), {
    path,
    floatPrecision: 2,
    plugins: [
      'convertStyleToAttrs',
      inheritPaint(path.endsWith('/folder.svg') ? EIconPart.Body : EIconPart.Glyph),
      {
        name: 'preset-default',
        params: {
          overrides: {
            convertColors: { shorthex: false, shortname: false },
            convertShapeToPath: { convertArcs: true },
            convertPathData: { applyTransforms: true, floatPrecision: 2 },
            moveElemsAttrsToGroup: false,
            removeUnknownsAndDefaults: false,
            removeUselessStrokeAndFill: false,
          },
        },
      },
      'convertTransform',
      { name: 'convertPathData', params: { applyTransforms: true, floatPrecision: 2 } },
      collect,
    ],
  })
  if (!viewBox || !paths.length) throw new Error(`${path}: empty art`)
  return { viewBox, paths }
}

function serializeArt(args: { member: string; art: IconArt }) {
  const value = JSON.stringify(args.art).replace(
    /"part":"(body|glyph)"/g,
    (_, part: string) => `"part":EIconPart.${part === 'body' ? 'Body' : 'Glyph'}`,
  )
  return `  [EFileIcon.${args.member}]: ${value},\n`
}

async function main() {
  const sourceIndex = process.argv.indexOf('--source')
  const source = process.argv[sourceIndex + 1]
  if (sourceIndex < 0 || !source)
    throw new Error('Usage: bun run tools/import-file-icons.ts --source <iconGenerator dir>')
  const files = sourceEntries(fileSources)
  const folders = sourceEntries(folderSources)
  const entries = [...files, ...folders]
  await mkdir(destination, { recursive: true })
  const chunks: string[][] = []
  for (const entry of entries) {
    const folder = folders.includes(entry)
    const art = await importArt(
      resolve(source, 'assets/icons', folder ? 'folders' : 'files', `${entry.source}.svg`),
    )
    if (folder) {
      const open = await importArt(
        resolve(source, 'assets/icons/foldersOpen', `${entry.source}.svg`),
      )
      if (open.viewBox !== art.viewBox) throw new Error(`${entry.source}: viewBox mismatch`)
      art.open = open.paths
    }
    const chunkIndex = Math.floor(entries.indexOf(entry) / 8)
    const chunk = chunks[chunkIndex] ?? []
    chunk.push(serializeArt({ member: entry.member, art }))
    chunks[chunkIndex] = chunk
  }
  await writeFile(
    resolve(destination, 'enum.ts'),
    `export enum EFileIcon {\n${entries.map((entry) => `  ${entry.member} = '${entry.value}',`).join('\n')}\n}\n`,
  )
  for (const [index, chunk] of chunks.entries()) {
    await writeFile(
      resolve(destination, `art-${index}.ts`),
      `${attribution}import { EFileIcon } from './enum'\nimport { EIconPart, type IconArt } from './types'\n\nexport const ART_${index} = {\n${chunk.join('')}} satisfies Partial<Record<EFileIcon, IconArt>>\n`,
    )
  }
  await writeFile(
    resolve(destination, 'art.ts'),
    `${attribution}${chunks.map((_, index) => `import { ART_${index} } from './art-${index}'`).join('\n')}\nimport type { EFileIcon } from './enum'\nimport type { IconArt } from './types'\n\nexport const FILE_ICON_ART: Record<EFileIcon, IconArt> = {\n${chunks.map((_, index) => `  ...ART_${index},`).join('\n')}\n}\n`,
  )
  const license = await readFile(resolve(source, 'LICENSE'), 'utf8')
  await writeFile(
    resolve(destination, 'LICENSE'),
    license.replace(
      'Copyright (c) 2017-2019 Elior Boukhobza',
      'Copyright (c) 2017-2019 Elior Boukhobza\nCopyright (c) 2015-2024 Elior "Mallowigi" Boukhobza',
    ),
  )
  console.log(`Imported ${files.length} file and ${folders.length} folder icons`)
}

await main()
