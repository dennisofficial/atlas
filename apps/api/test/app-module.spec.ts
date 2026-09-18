import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import { AppModule } from '../src/api/app.module'

describe('AppModule', () => {
  it('resolves the module graph', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile()
    expect(module).toBeDefined()
    await module.close()
  }, 30_000)
})
