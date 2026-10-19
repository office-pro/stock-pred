/**
 * POST /agent/multi-asset/preflight — invalid readiness policy returns a structured 400.
 */

import { BadRequestException } from '@nestjs/common';

jest.mock('@stockpred/database', () => ({}));

import { AgentController } from './agent.controller';

function controllerWith(run: jest.Mock): AgentController {
  const controller = Object.create(AgentController.prototype) as AgentController;
  (controller as unknown as { miCombinedPreflight: { run: jest.Mock } }).miCombinedPreflight = {
    run,
  };
  (controller as unknown as { arturoFlags: { niftyFundamentalsRequired: jest.Mock } }).arturoFlags =
    {
      niftyFundamentalsRequired: jest.fn().mockResolvedValue(false),
    };
  return controller;
}

async function preflightError(
  controller: AgentController,
  body: Record<string, unknown>,
): Promise<BadRequestException> {
  try {
    await controller.postCombinedBatchPreflight(body as never);
  } catch (err) {
    return err as BadRequestException;
  }
  throw new Error('expected preflight to throw');
}

describe('POST /agent/multi-asset/preflight readinessPolicy validation', () => {
  it('unknown version → 400 { code, message }; preflight not run', async () => {
    const run = jest.fn();
    const err = await preflightError(controllerWith(run), {
      universeType: 'NIFTY50',
      readinessPolicy: { id: 'ELIGIBLE_SUBSET', version: 'readiness-policy.v9' },
    });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toEqual({
      code: 'READINESS_POLICY_UNKNOWN_VERSION',
      message:
        'Unsupported readiness policy version: expected readiness-policy.v1, got readiness-policy.v9',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('ELIGIBLE_SUBSET without minimums → 400 READINESS_POLICY_MINIMUMS_REQUIRED', async () => {
    const run = jest.fn();
    const err = await preflightError(controllerWith(run), {
      universeType: 'NIFTY50',
      readinessPolicy: { id: 'ELIGIBLE_SUBSET', version: 'readiness-policy.v1' },
    });
    expect((err.getResponse() as { code: string }).code).toBe('READINESS_POLICY_MINIMUMS_REQUIRED');
    expect(run).not.toHaveBeenCalled();
  });

  it('internal failure during normalization is rethrown unchanged, not a 400', async () => {
    const run = jest.fn();
    const internal = new TypeError('internal failure');
    const readinessPolicy = {
      id: 'ELIGIBLE_SUBSET',
      get version(): string {
        throw internal;
      },
    };
    const err = await preflightError(controllerWith(run), {
      universeType: 'NIFTY50',
      readinessPolicy,
    });
    expect(err).toBe(internal);
    expect(err).not.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it('valid policy is passed to preflight; no policy sends none', async () => {
    const run = jest.fn(async (_cfg: unknown) => ({ canRun: true }));
    const controller = controllerWith(run);
    const policy = {
      id: 'ELIGIBLE_SUBSET',
      version: 'readiness-policy.v1',
      minimums: { minEligibleCount: 1, minEligibleFraction: 0.9 },
    };
    await controller.postCombinedBatchPreflight({
      universeType: 'NIFTY50',
      readinessPolicy: policy,
    } as never);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ readinessPolicy: policy });

    await controller.postCombinedBatchPreflight({ universeType: 'NIFTY50' } as never);
    expect(run.mock.calls[1]?.[0]).not.toHaveProperty('readinessPolicy');
  });
});
