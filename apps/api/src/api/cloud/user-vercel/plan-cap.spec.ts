import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { EVercelPlan } from '@dltech/atlas-wire/web'
import { assertWithinPlanCap } from './plan-cap'
import type { PlanSnapshot } from './vercel-credential-plan'

const snapshot = (plan: EVercelPlan): PlanSnapshot => ({ plan, planCheckedAt: new Date() })

describe('assertWithinPlanCap', () => {
  it('accepts sizes within the plan cap', () => {
    expect(() =>
      assertWithinPlanCap({ vcpus: 4, snapshot: snapshot(EVercelPlan.Hobby) }),
    ).not.toThrow()
    expect(() =>
      assertWithinPlanCap({ vcpus: 8, snapshot: snapshot(EVercelPlan.Pro) }),
    ).not.toThrow()
    expect(() =>
      assertWithinPlanCap({ vcpus: 32, snapshot: snapshot(EVercelPlan.Enterprise) }),
    ).not.toThrow()
  })

  it('rejects sizes above the plan cap with a clear message', () => {
    const attempt = () => assertWithinPlanCap({ vcpus: 8, snapshot: snapshot(EVercelPlan.Hobby) })
    expect(attempt).toThrow(BadRequestException)
    expect(attempt).toThrow('8 vCPU exceeds Hobby plan: up to 4 vCPU')
  })

  it('allows everything when the plan is unknown or missing', () => {
    expect(() =>
      assertWithinPlanCap({ vcpus: 32, snapshot: snapshot(EVercelPlan.Unknown) }),
    ).not.toThrow()
    expect(() => assertWithinPlanCap({ vcpus: 32, snapshot: null })).not.toThrow()
  })

  it('ignores a null size (account default)', () => {
    expect(() =>
      assertWithinPlanCap({ vcpus: null, snapshot: snapshot(EVercelPlan.Hobby) }),
    ).not.toThrow()
  })
})
