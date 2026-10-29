import { readFileSync } from 'node:fs'

import type { PromptContext } from '@dltech/atlas-core'

import { parseDeclaredServices, servicesFileOf } from '../../services/declared-services'
import { VolatilePromptFragment } from '../volatile'

const readServicesText = ({ root }: { root: string }): string | undefined => {
  try {
    return readFileSync(servicesFileOf({ root }), 'utf8')
  } catch {
    return undefined
  }
}

export class DeclaredServicesFragment extends VolatilePromptFragment {
  readonly id = 'environment.declared-services'

  stamp(ctx: PromptContext): string {
    return readServicesText({ root: ctx.projectDirectory }) ?? ''
  }

  text(ctx: PromptContext): string {
    const root = ctx.projectDirectory
    const source = readServicesText({ root })
    if (source === undefined) return ''

    const { services, rejections } = parseDeclaredServices({
      text: source,
      file: servicesFileOf({ root }),
    })
    const lines = [
      ".atlas/services.yaml declares this workspace's services. Call services_ensure before you need a URL or a running server; it starts what is missing, waits for health, and returns the URLs. Load the atlas-services skill for the schema and troubleshooting.",
    ]
    if (services.length > 0) {
      lines.push(`Declared services: ${services.map((service) => service.name).join(', ')}.`)
    }
    for (const rejection of rejections) {
      const subject = rejection.name === undefined ? 'file' : `service ${rejection.name}`
      lines.push(`Rejected (${subject}): ${rejection.detail}`)
    }
    return lines.join('\n')
  }
}
