import type { RenderDeploy } from './render-deploy-gate'

export function deployOf(entry: unknown): RenderDeploy | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  if (!('deploy' in entry)) return undefined
  const deploy = entry.deploy
  if (typeof deploy !== 'object' || deploy === null) return undefined
  if (!('id' in deploy) || typeof deploy.id !== 'string') return undefined
  if (!('status' in deploy) || typeof deploy.status !== 'string') return undefined
  const commitId = commitIdOf(deploy)
  if (commitId === undefined) return undefined
  return { id: deploy.id, status: deploy.status, commitId }
}

function commitIdOf(deploy: object): string | undefined {
  if ('commit' in deploy && typeof deploy.commit === 'object' && deploy.commit !== null) {
    if ('id' in deploy.commit && typeof deploy.commit.id === 'string') return deploy.commit.id
  }
  if (!('image' in deploy) || typeof deploy.image !== 'object' || deploy.image === null) {
    return undefined
  }
  if (!('ref' in deploy.image) || typeof deploy.image.ref !== 'string') return undefined
  const tag = deploy.image.ref.split(':').at(-1)
  return tag === undefined || tag === '' ? undefined : tag
}
