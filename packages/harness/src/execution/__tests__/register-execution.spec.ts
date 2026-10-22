import { describe, expect, it } from 'vitest'

import { AgentFileSystemPort, FileSystemPort, ProcessPort } from '@dltech/atlas-core'

import { createIsolatedContainer, registeredPortToken } from '../../container/injection'
import { DockerEngineToken } from '../../container/tokens'
import { DockerEngine } from '../docker/engine'
import { LocalFileSystemPort } from '../local-filesystem'
import { LoginEnvProcessPort } from '../login-env-process'
import { registerExecution } from '../register-execution'

const wired = () => {
  const container = createIsolatedContainer()
  registerExecution({ container })
  return container
}

describe('registerExecution', () => {
  it('binds the process port to the login-resolving local adapter', () => {
    expect(wired().resolve(registeredPortToken(ProcessPort))).toBeInstanceOf(LoginEnvProcessPort)
  })

  it('binds the filesystem port to the local adapter', () => {
    expect(wired().resolve(registeredPortToken(FileSystemPort))).toBeInstanceOf(LocalFileSystemPort)
  })

  it('aliases the agent filesystem port to the local adapter until a router overrides it', () => {
    expect(wired().resolve(registeredPortToken(AgentFileSystemPort))).toBeInstanceOf(
      LocalFileSystemPort,
    )
  })

  it('registers one shared docker engine for the container', () => {
    const wiredContainer = wired()

    expect(wiredContainer.resolve(DockerEngineToken)).toBeInstanceOf(DockerEngine)
    expect(wiredContainer.resolve(DockerEngineToken)).toBe(
      wiredContainer.resolve(DockerEngineToken),
    )
  })

  it('lets an isolated container rebind the process port without touching the original', () => {
    class OtherProcesses implements ProcessPort {
      spawn(): never {
        throw new Error('not spawned in this test')
      }
      which(): string | null {
        return null
      }
    }

    const first = wired()
    const second = wired()
    second.register(registeredPortToken(ProcessPort), { useClass: OtherProcesses })

    expect(second.resolve(registeredPortToken(ProcessPort))).toBeInstanceOf(OtherProcesses)
    expect(first.resolve(registeredPortToken(ProcessPort))).toBeInstanceOf(LoginEnvProcessPort)
  })
})
