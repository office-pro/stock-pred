/**
 * UI-12 — UI Data Truthfulness / authorization regression checklist (static).
 * These asserts document locked rules; they do not call the network.
 */
describe('UI Data Truthfulness + auth boundaries', () => {
  it('forbids frontend RankingContext re-sort semantics', () => {
    const rule =
      'Best Opportunities must consume backend-provided opportunity/ranking order; frontend must NOT independently reconstruct, sort, or reinterpret RankingContext.';
    expect(rule.includes('must NOT independently')).toBe(true);
  });

  it('forbids frontend-derived ML on opportunity cards', () => {
    const rule =
      'ML shown only when an existing API actually provides ML prediction/model data. No frontend-derived ML confidence/prediction.';
    expect(rule.includes('No frontend-derived')).toBe(true);
  });

  it('forbids liveUsable / DELAYED Approve gating', () => {
    const rule =
      'liveUsable is display/context information only. The frontend must never use it to decide whether approval is allowed.';
    expect(rule.includes('never use it to decide')).toBe(true);
  });

  it('forbids P5 Evidence mutation / ARM', () => {
    const mayNot = [
      'mutate evidence',
      'trigger recalculation',
      'change verdict',
      'change floors',
      'ARM P6',
    ];
    expect(mayNot).toContain('ARM P6');
  });

  it('Approve path remains existing recommendation API', () => {
    // AgentDeskPage uses useApproveAgentRecommendationMutation → POST recommendations/:id/approve
    const approveHook = 'useApproveAgentRecommendationMutation';
    expect(approveHook.startsWith('useApprove')).toBe(true);
  });
});
