/**
 * CLI Agent Executor
 *
 * Orchestrates running an agent command, collecting output,
 * and retrying on transient failures. Sits between the
 * per-agent CLI files and the lower-level runner utilities.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildAgentCommand, parseAgentOutput } from "./cli-agent-runner";
import type { AgentConfig, AgentResult, RunOptions } from "./cli-agent-types";

const execFileAsync = promisify(execFile);

/** Maximum number of attempts before giving up on a transient error. */
const MAX_RETRIES = 3;

/** Base delay (ms) for exponential back-off between retries. */
const BASE_RETRY_DELAY_MS = 1_500;

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true when the error message looks like a transient network /
 * rate-limit problem that is worth retrying.
 */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("503") ||
    msg.includes("529")
  );
}

/**
 * Execute a single agent invocation and return the parsed result.
 *
 * @param config  - Agent-specific configuration (name, binary path, flags …)
 * @param options - Runtime options (prompt, workdir, timeout, env overrides)
 */
export async function executeAgent(
  config: AgentConfig,
  options: RunOptions
): Promise<AgentResult> {
  const { file, args } = buildAgentCommand(config, options);

  const timeoutMs = options.timeoutMs ?? 120_000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync(file, args, {
        cwd: options.workdir ?? process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024, // 50 MB
        env: {
          ...process.env,
          ...options.envOverrides,
        },
      });

      const result = parseAgentOutput(stdout);

      if (stderr && stderr.trim().length > 0) {
        // Surface non-fatal stderr as a warning on the result object so
        // callers can decide what to do with it.
        result.warnings = (result.warnings ?? []).concat(stderr.trim());
      }

      return result;
    } catch (err) {
      lastError = err;

      const retryable = isRetryable(err);
      console.error(
        `[executeAgent] attempt ${attempt}/${MAX_RETRIES} failed` +
          (retryable ? " (retryable)" : "") +
          `:`,
        err instanceof Error ? err.message : err
      );

      if (!retryable || attempt === MAX_RETRIES) break;

      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Run multiple agents in parallel and collect all results.
 * Failures in individual agents are captured rather than thrown so the
 * caller receives a complete picture of what succeeded and what failed.
 */
export async function executeAgentsInParallel(
  tasks: Array<{ config: AgentConfig; options: RunOptions }>
): Promise<Array<AgentResult | { error: string }>> {
  return Promise.all(
    tasks.map(({ config, options }) =>
      executeAgent(config, options).catch((err: unknown) => ({
        error: err instanceof Error ? err.message : String(err),
      }))
    )
  );
}
