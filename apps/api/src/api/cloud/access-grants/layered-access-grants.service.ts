import {
  EAccessScope,
  EConfigLayer,
  type AccessGrant,
  type AccessGrantLayeredList,
  type ConfigLayerOwner,
} from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'

import { PERSONAL_LAYER_OWNER } from '../../../_lib/config-layers/layer-owner'
import { overrideIndexOf, overrideOf } from '../../../_lib/config-layers/override-index'
import { GroupsService } from '../project-groups/project-groups.service'
import { ProjectsService } from '../projects/projects.service'
import { GroupAccessGrantsService } from './group-access-grants.service'
import { PersonalAccessGrantsService } from './personal-access-grants.service'
import { ProjectAccessGrantsService } from './project-access-grants.service'

type GrantLayer = {
  layer: EConfigLayer
  owner: ConfigLayerOwner
  grants: readonly AccessGrant[]
}

@Injectable()
export class LayeredAccessGrantsService {
  constructor(
    private readonly personal: PersonalAccessGrantsService,
    private readonly groupGrants: GroupAccessGrantsService,
    private readonly projectGrants: ProjectAccessGrantsService,
    private readonly groups: GroupsService,
    private readonly projects: ProjectsService,
  ) {}

  async layered(args: {
    userId: string
    scope:
      | { kind: EAccessScope.Personal }
      | { kind: EAccessScope.Group; groupId: string }
      | { kind: EAccessScope.Project; projectId: string }
  }): Promise<AccessGrantLayeredList> {
    const layers = await this.layersOf(args)
    const secretIndex = overrideIndexOf({
      layers: layers.map((entry) => ({
        layer: entry.layer,
        items: entry.grants.flatMap((grant) => grant.secrets),
      })),
      keyOf: (secret) => secret.name,
    })
    const fileIndex = overrideIndexOf({
      layers: layers.map((entry) => ({
        layer: entry.layer,
        items: entry.grants.flatMap((grant) => grant.files),
      })),
      keyOf: (file) => file.path,
    })
    return {
      layers: layers.map((entry) => ({
        layer: entry.layer,
        owner: entry.owner,
        grants: entry.grants.map((grant) => ({
          ...grant,
          secrets: grant.secrets.map((secret) => ({
            ...secret,
            overriddenBy: overrideOf({ index: secretIndex, layer: entry.layer, key: secret.name }),
          })),
          files: grant.files.map((file) => ({
            ...file,
            overriddenBy: overrideOf({ index: fileIndex, layer: entry.layer, key: file.path }),
          })),
        })),
      })),
    }
  }

  private async layersOf(args: {
    userId: string
    scope:
      | { kind: EAccessScope.Personal }
      | { kind: EAccessScope.Group; groupId: string }
      | { kind: EAccessScope.Project; projectId: string }
  }): Promise<readonly GrantLayer[]> {
    const personal: GrantLayer = {
      layer: EConfigLayer.Personal,
      owner: PERSONAL_LAYER_OWNER,
      grants: await this.personal.list(args.userId),
    }
    if (args.scope.kind === EAccessScope.Personal) return [personal]
    if (args.scope.kind === EAccessScope.Group) {
      return [
        personal,
        await this.groupLayerOf({ userId: args.userId, groupId: args.scope.groupId }),
      ]
    }
    const project = await this.projects.editable({
      userId: args.userId,
      projectId: args.scope.projectId,
    })
    const group =
      project.groupId === null
        ? []
        : [await this.groupLayerOf({ userId: args.userId, groupId: project.groupId })]
    return [
      personal,
      ...group,
      {
        layer: EConfigLayer.Project,
        owner: { id: project.id, name: project.name },
        grants: await this.projectGrants.list({
          userId: args.userId,
          projectId: project.id,
        }),
      },
    ]
  }

  private async groupLayerOf(args: { userId: string; groupId: string }): Promise<GrantLayer> {
    const group = await this.groups.owned(args)
    return {
      layer: EConfigLayer.Group,
      owner: { id: group.id, name: group.name },
      grants: await this.groupGrants.list(args),
    }
  }
}
