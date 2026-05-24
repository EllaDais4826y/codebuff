/**
 * CLI Agent Orchestrator
 *
 * Coordinates agent execution by combining the runner (command building/parsing)
 * and executor (retry logic/process management) into a unified interface.
 */

import { buildAgentCommand, parseAgentOutput } from "./cli-agent-runner";
import { sleep, isRetryable } from "./cli-agent-executor";
import type { AgentConfig, AgentResult, AgentTask } from "./cli-agent-types";
import { execSync, spawnSync } from "child_process";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface OrchestratorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  verbose?: boolean;
  timeoutMs?: number;
}

export interface OrchestratorResult {
  success: boolean;
  output: string;
  agentResult?: AgentResult;
  attempts: number;
  durationMs: number;
  error?: string;
}

/**
 * Runs an agent task with retry logic and structured output parsing.
 */
export async function runAgentTask(
  config: AgentConfig,
  task: AgentTask,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const {
    maxRetries = MAX_RETRIES,
    retryDelayMs = RETRY_DELAY_MS,
    verbose = false,
    timeoutMs = 120_000,
  } = options;

  const startTime = Date.now();
  let attempts = 0;
  let lastError: string | undefined;

  while (attempts < maxRetries) {
    attempts++;

    if (verbose) {
      console.log(`[orchestrator] Attempt ${attempts}/${maxRetries} for task: ${task.id}`);
    }

    try {
      const command = buildAgentCommand(config, task);

      if (verbose) {
        console.log(`[orchestrator] Running: ${command.join(" ")}`);
      }

      const result = spawnSync(command[0], command.slice(1), {
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env },
      });

      const rawOutput = result.stdout ?? "";
      const stderrOutput = result.stderr ?? "";

      if (result.status !== 0) {
        const errorMsg = stderrOutput || `Process exited with code ${result.status}`;
        lastError = errorMsg;

        if (verbose) {
          console.warn(`[orchestrator] Agent failed: ${errorMsg}`);
        }

        if (!isRetryable(result.status ?? 1, stderrOutput)) {
          break;
        }

        if (attempts < maxRetries) {
          await sleep(retryDelayMs * attempts); // exponential-ish backoff
        }
        continue;
      }

      const agentResult = parseAgentOutput(rawOutput);

      return {
        success: true,
        output: rawOutput,
        agentResult,
        attempts,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (verbose) {
        console.warn(`[orchestrator] Exception on attempt ${attempts}: ${lastError}`);
      }

      if (attempts < maxRetries) {
        await sleep(retryDelayMs * attempts);
      }
    }
  }

  return {
    success: false,
    output: "",
    attempts,
    durationMs: Date.now() - startTime,
    error: lastError ?? "Unknown error",
  };
}

/**
 * Validates that the required agent binary is available on PATH.
 */
export function checkAgentAvailable(binaryName: string): boolean {
  try {
    execSync(`which ${binaryName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
