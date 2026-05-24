/**
 * Metrics collection and reporting for CLI agent runs.
 * Tracks token usage, latency, success rates, and cost estimates.
 */

export interface AgentRunMetrics {
  agentName: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  retryCount: number;
  errorType?: string;
  tokensInput?: number;
  tokensOutput?: number;
  estimatedCostUsd?: number;
}

export interface AggregateMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  averageDurationMs: number;
  totalRetries: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCostUsd: number;
  byAgent: Record<string, AgentAggregateSummary>;
}

export interface AgentAggregateSummary {
  runs: number;
  successes: number;
  failures: number;
  averageDurationMs: number;
  totalRetries: number;
}

// Cost per 1M tokens (input/output) for rough estimates
const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  claude: { input: 3.0, output: 15.0 },
  gemini: { input: 1.25, output: 5.0 },
  codex: { input: 5.0, output: 15.0 },
  codebuff: { input: 0, output: 0 },
};

export function createMetrics(agentName: string): AgentRunMetrics {
  return {
    agentName,
    startTime: Date.now(),
    success: false,
    retryCount: 0,
  };
}

export function finalizeMetrics(
  metrics: AgentRunMetrics,
  success: boolean,
  errorType?: string
): AgentRunMetrics {
  const endTime = Date.now();
  const durationMs = endTime - metrics.startTime;

  const costKey = Object.keys(COST_PER_MILLION_TOKENS).find((k) =>
    metrics.agentName.toLowerCase().includes(k)
  );
  const costRates = costKey ? COST_PER_MILLION_TOKENS[costKey] : null;

  let estimatedCostUsd: number | undefined;
  if (costRates && metrics.tokensInput !== undefined && metrics.tokensOutput !== undefined) {
    estimatedCostUsd =
      (metrics.tokensInput / 1_000_000) * costRates.input +
      (metrics.tokensOutput / 1_000_000) * costRates.output;
  }

  return {
    ...metrics,
    endTime,
    durationMs,
    success,
    errorType,
    estimatedCostUsd,
  };
}

export function aggregateMetrics(runs: AgentRunMetrics[]): AggregateMetrics {
  const successfulRuns = runs.filter((r) => r.success);
  const failedRuns = runs.filter((r) => !r.success);

  const durations = runs.filter((r) => r.durationMs !== undefined).map((r) => r.durationMs!);
  const averageDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const byAgent: Record<string, AgentAggregateSummary> = {};
  for (const run of runs) {
    if (!byAgent[run.agentName]) {
      byAgent[run.agentName] = { runs: 0, successes: 0, failures: 0, averageDurationMs: 0, totalRetries: 0 };
    }
    const summary = byAgent[run.agentName];
    summary.runs++;
    summary.totalRetries += run.retryCount;
    if (run.success) summary.successes++;
    else summary.failures++;

    const agentDurations = runs
      .filter((r) => r.agentName === run.agentName && r.durationMs !== undefined)
      .map((r) => r.durationMs!);
    summary.averageDurationMs =
      agentDurations.length > 0 ? agentDurations.reduce((a, b) => a + b, 0) / agentDurations.length : 0;
  }

  return {
    totalRuns: runs.length,
    successfulRuns: successfulRuns.length,
    failedRuns: failedRuns.length,
    successRate: runs.length > 0 ? successfulRuns.length / runs.length : 0,
    averageDurationMs,
    totalRetries: runs.reduce((sum, r) => sum + r.retryCount, 0),
    totalTokensInput: runs.reduce((sum, r) => sum + (r.tokensInput ?? 0), 0),
    totalTokensOutput: runs.reduce((sum, r) => sum + (r.tokensOutput ?? 0), 0),
    totalEstimatedCostUsd: runs.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
    byAgent,
  };
}

export function formatMetricsSummary(aggregate: AggregateMetrics): string {
  const lines: string[] = [
    `=== Agent Run Summary ===`,
    `Total runs: ${aggregate.totalRuns} (${aggregate.successfulRuns} succeeded, ${aggregate.failedRuns} failed)`,
    `Success rate: ${(aggregate.successRate * 100).toFixed(1)}%`,
    `Avg duration: ${(aggregate.averageDurationMs / 1000).toFixed(2)}s`,
    `Total retries: ${aggregate.totalRetries}`,
    `Est. cost: $${aggregate.totalEstimatedCostUsd.toFixed(4)}`,
  ];

  if (Object.keys(aggregate.byAgent).length > 1) {
    lines.push(`\nBy agent:`);
    for (const [agent, summary] of Object.entries(aggregate.byAgent)) {
      lines.push(
        `  ${agent}: ${summary.successes}/${summary.runs} ok, avg ${(summary.averageDurationMs / 1000).toFixed(2)}s`
      );
    }
  }

  return lines.join("\n");
}
