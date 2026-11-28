import { describe, expect, it } from 'bun:test'
import { Children, isValidElement, type ReactNode } from 'react'

import { popupChevronMotion, popupMotion } from '#lib/popup-motion'
import { cn } from 'cn'
import { ComboboxContent } from '../combobox'
import { ContextMenuContent } from '../context-menu'
import { DropdownMenuContent, DropdownMenuSubContent } from '../dropdown-menu'
import { HoverCardContent } from '../hover-card'
import { MenubarContent, MenubarSubContent } from '../menubar'
import { NavigationMenuPositioner } from '../navigation-menu'
import { PopoverContent } from '../popover'
import { SelectContent, SelectTrigger } from '../select'
import { TooltipContent } from '../tooltip'

type PopupElementProps = {
  children?: ReactNode
  className?: string
  alignItemWithTrigger?: boolean
}

function classesIn(node: ReactNode): string[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<PopupElementProps>(child)) return []
    return [child.props.className ?? '', ...classesIn(child.props.children)]
  })
}

const popups = [
  ['Select', SelectContent({})],
  ['DropdownMenu', DropdownMenuContent({})],
  ['Combobox', ComboboxContent({})],
  ['ContextMenu', ContextMenuContent({})],
  ['HoverCard', HoverCardContent({})],
  ['Popover', PopoverContent({})],
  ['Tooltip', TooltipContent({})],
  ['NavigationMenu', NavigationMenuPositioner({})],
] as const

describe('popup motion', () => {
  it.each(popups)('%s shares reversible entry and exit transitions', (_, element) => {
    const classes = classesIn(element).join(' ').split(' ')
    expect(classes).toContain('duration-150')
    expect(classes).toContain('ease-out')
    expect(classes).toContain('data-starting-style:opacity-0')
    expect(classes).toContain('data-starting-style:[transform:scale(0.96)]')
    expect(classes).toContain('data-ending-style:opacity-0')
    expect(classes).toContain('data-ending-style:duration-100')
    expect(classes).toContain('data-ending-style:ease-in')
    expect(classes).toContain('motion-reduce:transition-none')
    expect(classes).toContain('motion-reduce:transform-none!')
    expect(classes).toContain('motion-reduce:translate-none!')
    expect(classes.some((value) => value.includes('animate-in'))).toBe(false)
    expect(classes.some((value) => value.includes('animate-none'))).toBe(false)
  })

  it('preserves selected-item alignment and animates it without a side slide', () => {
    const content = SelectContent({})
    const positioner = Children.toArray(content.props.children)[0]
    expect(isValidElement<PopupElementProps>(positioner)).toBe(true)
    if (!isValidElement<PopupElementProps>(positioner)) return
    expect(positioner.props.alignItemWithTrigger).toBe(true)
    expect(popupMotion).toContain('data-[side=none]:data-starting-style:[transform:scaleY(0.96)]')
    expect(popupMotion).toContain('data-[side=none]:data-ending-style:[transform:scaleY(0.96)]')
    expect(popupMotion).not.toContain('data-[side=none]:translate')
  })

  it.each([
    ['dropdown submenu', DropdownMenuSubContent({})],
    ['menubar', MenubarContent({})],
    ['menubar submenu', MenubarSubContent({})],
  ])('%s does not override the inherited motion', (_, element) => {
    const classes = cn(popupMotion, ...classesIn(element)).split(' ')
    expect(classes).toContain('duration-150')
    expect(classes).toContain('data-ending-style:duration-100')
    expect(classes.some((value) => value.includes('animate-'))).toBe(false)
  })

  it('rotates its built-in Select chevron with the trigger state', () => {
    expect(SelectTrigger({}).props.className).toContain('group/popup-trigger')
    expect(popupChevronMotion).toContain('group-aria-expanded/popup-trigger:rotate-180')
    expect(popupChevronMotion).toContain('duration-150')
    expect(popupChevronMotion).toContain('motion-reduce:transition-none')
  })
})
