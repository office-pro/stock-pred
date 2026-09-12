import { emptyBreakerMetrics } from './circuit-breakers';
import {
  evaluateP7BreakerSystem,
  mapAggregateToEnforcement,
  buildP7BreakerMetrics,
} from './p7-breaker-aggregation';

describe('p7-breaker-aggregation (P7.5)', () => {
  it('maps CLEAR and INSUFFICIENT to NONE enforcement', () => {
    expect(mapAggregateToEnforcement('CLEAR')).toBe('NONE');
    expect(mapAggregateToEnforcement('INSUFFICIENT')).toBe('NONE');
  });

  it('maps UNKNOWN and RESTRICT to RESTRICT_AUTONOMOUS', () => {
    expect(mapAggregateToEnforcement('UNKNOWN')).toBe('RESTRICT_AUTONOMOUS');
    expect(mapAggregateToEnforcement('RESTRICT')).toBe('RESTRICT_AUTONOMOUS');
  });

  it('maps STOP and SEVERE_STOP to FORCE_APPROVAL', () => {
    expect(mapAggregateToEnforcement('STOP')).toBe('FORCE_APPROVAL');
    expect(mapAggregateToEnforcement('SEVERE_STOP')).toBe('FORCE_APPROVAL');
  });

  it('precedence: STOP > RESTRICT > CLEAR', () => {
    const report = evaluateP7BreakerSystem({
      metrics: emptyBreakerMetrics(),
      brokerConnected: true,
      advancedSubStates: {
        quality_drift: 'STOP',
        ev_drift: 'DEGRADED',
        calibration_drift: 'CLEAR',
        regime_drift: 'CLEAR',
      },
    });
    expect(report.aggregate).toBe('STOP');
    expect(report.enforcement).toBe('FORCE_APPROVAL');
  });

  it('buildP7BreakerMetrics leaves execution_drift null', () => {
    const built = buildP7BreakerMetrics(emptyBreakerMetrics(), { records: [] });
    expect(built.breakerMetrics.executionDeterioration).toBeNull();
  });

  it('SEVERE_STOP when quality+ev+calibration all STOP', () => {
    const report = evaluateP7BreakerSystem({
      metrics: emptyBreakerMetrics(),
      brokerConnected: true,
      advancedSubStates: {
        quality_drift: 'STOP',
        ev_drift: 'STOP',
        calibration_drift: 'STOP',
        regime_drift: 'CLEAR',
      },
    });
    expect(report.aggregate).toBe('SEVERE_STOP');
  });

  it('tracks insufficient advanced breakers', () => {
    const report = evaluateP7BreakerSystem({
      metrics: emptyBreakerMetrics(),
      brokerConnected: true,
      advancedSubStates: {
        quality_drift: 'INSUFFICIENT',
        ev_drift: 'CLEAR',
        calibration_drift: 'CLEAR',
        regime_drift: 'CLEAR',
      },
    });
    expect(report.insufficientBreakers).toContain('quality_drift');
    expect(report.aggregate).toBe('INSUFFICIENT');
  });
});
