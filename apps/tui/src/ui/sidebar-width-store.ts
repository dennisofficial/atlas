import { SIDEBAR_WIDTH } from './theme'

let held = SIDEBAR_WIDTH

export const sidebarWidth = (): number => held

export const applySidebarWidth = (next: number): void => {
  held = next
}
