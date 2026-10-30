import { readFileSync } from 'node:fs'

import { EServiceStatus, type PromptContext } from '@dltech/atlas-core'

import { parseDeclaredServices, servicesFileOf } from '../../services/declared-services'
import { hashOfDeclared } from '../../services/declared-launch'
import type { ServiceRegistryPort } from '../../services/service-registry-port'
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

  constructor(private readonly registry?: ServiceRegistryPort) {
    super()
  }

  stamp(ctx: PromptContext): string {
    return `${this.registry?.version() ?? 0}:${readServicesText({ root: ctx.projectDirectory }) ?? ''}`
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
      ".atlas/services.yaml declares this workspace's services. Call services_ensure before you need a URL or a running server; it starts what is missing, restarts what changed, waits for health, and returns the URLs. Declared servers are started only through services_ensure - when one is wrong, fix services.yaml and ensure again rather than starting it by hand. Load the atlas skill and read its references/services.md for the schema and troubleshooting.",
    ]
    if (services.length > 0) {
      lines.push(`Declared services: ${services.map((service) => service.name).join(', ')}.`)
    }
    const stale = services.filter((service) =>
      this.registry
        ?.list()
        .some(
          (one) =>
            one.name === service.name &&
            one.status === EServiceStatus.Running &&
            one.declarationHash !== undefined &&
            one.declarationHash !== hashOfDeclared(service),
        ),
    )
    if (stale.length > 0) {
      lines.push(
        `Stale (services.yaml changed since they started; call services_ensure to restart): ${stale.map((service) => service.name).join(', ')}.`,
      )
    }
    for (const rejection of rejections) {
      const subject = rejection.name === undefined ? 'file' : `service ${rejection.name}`
      lines.push(`Rejected (${subject}): ${rejection.detail}`)
    }
    return lines.join('\n')
  }
}
