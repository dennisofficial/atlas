import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

import { buildThemeCss, toKebab } from '../css'
import { semantic, EColorScheme, type SemanticTheme } from '../semantic'

const SHADCN_VARIABLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
]

const ATLAS_EXTRAS = [
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'code',
  'link',
  'diff-add',
  'diff-remove',
  'syntax-keyword',
  'scrollbar-thumb',
]

function themeBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}', start))
}

describe('semantic tokens', () => {
  test('both themes define exactly the same keys', () => {
    const darkKeys = Object.keys(semantic[EColorScheme.Dark])
    const lightKeys = Object.keys(semantic[EColorScheme.Light])
    expect(lightKeys.sort()).toEqual(darkKeys.sort())
  })

  test('no token value is empty', () => {
    for (const scheme of Object.values(EColorScheme)) {
      const theme: SemanticTheme = semantic[scheme]
      for (const [name, value] of Object.entries(theme)) {
        expect(value, `${scheme}.${name}`).toBeTruthy()
      }
    }
  })

  test('kebab-casing keeps digits attached to their word', () => {
    expect(toKebab('chart1')).toBe('chart-1')
    expect(toKebab('sidebarPrimaryForeground')).toBe('sidebar-primary-foreground')
  })
})

describe('theme.css', () => {
  test('checked-in stylesheet matches the current tokens', () => {
    const onDisk = readFileSync(`${import.meta.dirname}/../../styles/theme.css`, 'utf8')
    expect(onDisk).toBe(buildThemeCss())
  })

  test('is dark-first: :root holds the dark theme, light is opt-in', () => {
    const css = buildThemeCss()
    expect(themeBlock(css, ':root')).toContain(
      `--background: ${semantic[EColorScheme.Dark].background};`,
    )
    expect(themeBlock(css, '[data-theme="day"], [data-theme="light"], .light')).toContain(
      `--background: ${semantic[EColorScheme.Light].background};`,
    )
  })

  test('defines every shadcn variable and Atlas extra in both schemes', () => {
    const css = buildThemeCss()
    const dark = themeBlock(css, ':root')
    const light = themeBlock(css, '[data-theme="day"], [data-theme="light"], .light')
    for (const name of [...SHADCN_VARIABLES, ...ATLAS_EXTRAS]) {
      expect(dark, `dark --${name}`).toContain(`  --${name}: `)
      expect(light, `light --${name}`).toContain(`  --${name}: `)
    }
  })

  test('routes every semantic color to its Tailwind namespace', () => {
    const css = buildThemeCss()
    for (const name of [...SHADCN_VARIABLES, ...ATLAS_EXTRAS]) {
      if (name.startsWith('scrollbar-')) continue
      expect(css).toContain(`--color-${name}: var(--${name});`)
    }
  })

  test("keeps shadcn's radius scale derived from --radius", () => {
    const css = buildThemeCss()
    expect(css).toContain('--radius: 0.625rem;')
    expect(css).toContain('--radius-lg: var(--radius);')
    expect(css).toContain('--radius-sm: calc(var(--radius) * 0.6);')
  })

  test('imports the shadcn stylesheet chain', () => {
    const css = buildThemeCss()
    expect(css).toContain('@import "tailwindcss";')
    expect(css).toContain('@import "tw-animate-css";')
    expect(css).toContain('@import "shadcn/tailwind.css";')
  })

  test('dark: utilities apply unless a light scope is active', () => {
    expect(buildThemeCss()).toContain(
      '@custom-variant dark (&:where(:not([data-theme="day"], [data-theme="day"] *, [data-theme="light"], [data-theme="light"] *, .light, .light *)));',
    )
  })

  test("leaves Tailwind's default scale alone", () => {
    const css = buildThemeCss()
    expect(css).not.toContain('--spacing:')
    expect(css).not.toContain('--text-')
    expect(css).not.toContain('--font-weight-')
    expect(css).not.toContain('--tracking-')
  })

  test('keeps Atlas fonts', () => {
    const css = buildThemeCss()
    expect(css).toContain('--font-sans: "Geist"')
    expect(css).toContain('--font-mono: "JetBrains Mono"')
    expect(css).toContain('--font-display: "Space Grotesk"')
  })
})
