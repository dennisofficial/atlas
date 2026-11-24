import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultDesktopHome({ platformHome }: { platformHome?: string } = {}): string {
  return join(platformHome ?? homedir(), 'Library', 'Application Support', 'Atlas')
}
