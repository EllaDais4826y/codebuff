/**
 * CLI Agent Runner
 * Provides a unified interface for running different CLI agents (claude, codex, gemini, codebuff)
 * with consistent error handling, retries, and result parsing.
 */

import { execSync, SpawnSyncReturns } from "child_process";
import { AgentResult, AgentRunOptions, AgentType } from "./cli-agent-types";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_RETRIES = 2;

/**
 * Sanitizes shell arguments to prevent injection
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}' `;
}

/**
 * Parses the raw stdout from an agent into a structured result.
 * Looks for JSON blocks or falls back to plain text.
 */
export function parseAgentOutput(raw: string): Partial<AgentResult> {
  // Try to extract a JSON block from the output
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // fall through to plain text
    }
  }

  // Try raw JSON
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.parse(trimmed);
    }
  } catch {
    // fall through
  }

  return { rawOutput: raw };
}

/**
 * Builds the CLI command string for a given agent type.
 */
export function buildAgentCommand(
  agentType: AgentType,
  prompt: string,
  options: AgentRunOptions = {}
): string {
  const escapedPrompt = escapeShellArg(prompt);

  switch (agentType) {
    case "claude":
      return `npx ts-node .agents/claude-code-cli.ts --prompt ${escapedPrompt}`;
    case "codex":
      return `npx ts-node .agents/codex-cli.ts --prompt ${escapedPrompt}`;
    case "gemini":
      return `npx ts-node .agents/gemini-cli.ts --prompt ${escapedPrompt}`;
    case "codebuff":
      return `npx ts-node .agents/codebuff-local-cli.ts --prompt ${escapedPrompt}`;
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

/**
 * Runs a CLI agent with the given prompt and options.
 * Handles retries and timeout.
 */
export async function runAgent(
  agentType: AgentType,
  prompt: string,
  options: AgentRunOptions = {}
): Promise<AgentResult> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ?? process.cwd();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const command = buildAgentCommand(agentType, prompt, options);

      if (options.debug) {
        console.error(`[cli-agent-runner] attempt ${attempt + 1}: ${command}`);
      }

      const result = execSync(command, {
        cwd,
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parsed = parseAgentOutput(result);

      return {
        success: true,
        agentType,
        attempt: attempt + 1,
        rawOutput: result,
        ...parsed,
      } as AgentResult;
    } catch (err: any) {
      lastError = err;
      const stderr = err.stderr ?? "";
      if (options.debug) {
        console.error(`[cli-agent-runner] attempt ${attempt + 1} failed:`, stderr || err.message);
      }
      // Don't retry on timeout
      if (err.signal === "SIGTERM" || String(err.message).includes("ETIMEDOUT")) {
        break;
      }
    }
  }

  return {
    success: false,
    agentType,
    attempt: maxRetries + 1,
    rawOutput: "",
    error: lastError?.message ?? "Unknown error",
  } as AgentResult;
}
