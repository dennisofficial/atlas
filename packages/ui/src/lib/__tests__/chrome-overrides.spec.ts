import { describe, expect, test } from 'bun:test'

import { chromeOverridesIn } from '../chrome-overrides'

const componentSpecifiers = [/^@dltech\/atlas-ui\/components\//, /^#components\//]

function scan({ body, imports }: { body: string; imports?: string }) {
  const header =
    imports ??
    `import { Button } from '@dltech/atlas-ui/components/button'\nimport { Skeleton } from '@dltech/atlas-ui/components/skeleton'\n`
  return chromeOverridesIn({
    source: `${header}export const X = () => (\n${body}\n)\n`,
    fileName: 'x.tsx',
    componentSpecifiers,
  })
}

describe('chromeOverridesIn', () => {
  test('flags a literal chrome class with its line and component', () => {
    expect(scan({ body: '<Button className="px-4 mt-2">x</Button>' })).toEqual([
      { line: 4, component: 'Button', token: 'px-4' },
    ])
  })

  test('flags a braced string and a template literal', () => {
    const found = scan({
      body: '<Button className={`py-2 ${x} gap-1`} /><Button className={"rounded-lg"} />',
    })
    expect(found.map((item) => item.token)).toEqual(['py-2', 'gap-1', 'rounded-lg'])
  })

  test('reads cn() arguments including conditionals and ternaries', () => {
    const found = scan({
      body: `<Button className={cn('flex', open && 'bg-muted', big ? 'h-10' : 'size-[3px]', { a: 1 })} />`,
    })
    expect(found.map((item) => item.token)).toEqual(['bg-muted', 'h-10', 'size-[3px]'])
  })

  test('strips variant prefixes, including bracketed ones', () => {
    const found = scan({
      body: '<Button className="hover:px-2 md:dark:gap-3 data-[state=open]:bg-muted [&>svg]:size-4 data-[x:y]:border" />',
    })
    expect(found.map((item) => item.token)).toEqual([
      'px-2',
      'gap-3',
      'bg-muted',
      'size-4',
      'border',
    ])
  })

  test('strips leading and trailing important markers', () => {
    const found = scan({ body: '<Button className="!p-0 shadow-none! -mt-1" />' })
    expect(found.map((item) => item.token)).toEqual(['p-0', 'shadow-none'])
  })

  test('matches negative paddings and arbitrary text sizes', () => {
    const found = scan({ body: '<Button className="-px-1 text-[11px] ring-1" />' })
    expect(found.map((item) => item.token)).toEqual(['-px-1', 'text-[11px]', 'ring-1'])
  })

  test('ignores elements that are not imported design-system components', () => {
    const found = scan({
      body: '<div className="px-4 gap-2"><Local className="p-2" /></div>',
    })
    expect(found).toEqual([])
  })

  test('ignores components from other modules', () => {
    const found = scan({
      imports: `import { Button } from './button'\n`,
      body: '<Button className="px-4" />',
    })
    expect(found).toEqual([])
  })

  test('follows aliased and namespace imports and member tags', () => {
    const aliased = scan({
      imports: `import { Button as Btn } from '#components/button'\n`,
      body: '<Btn className="px-4" />',
    })
    expect(aliased).toEqual([{ line: 3, component: 'Btn', token: 'px-4' }])

    const namespaced = scan({
      imports: `import * as Card from '#components/card'\n`,
      body: '<Card.Root className="p-2" />',
    })
    expect(namespaced).toEqual([{ line: 3, component: 'Card.Root', token: 'p-2' }])
  })

  test('exempts Skeleton by default', () => {
    expect(scan({ body: '<Skeleton className="h-4 w-20 rounded-md" />' })).toEqual([])
  })

  test('ignores layout, typography and color tokens', () => {
    const found = scan({
      body: `<Button className="w-full min-h-0 max-h-96 min-w-0 max-w-sm mt-2 mb-1 mx-auto flex items-center justify-end text-muted-foreground text-xs font-mono font-medium truncate h-full size-full" />`,
    })
    expect(found).toEqual([])
  })
})
