/**
 * CLI Agent Logger
 * Provides structured logging utilities for agent execution with
 * support for different log levels, formatting, and output destinations.
 */

import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  agentId?: string;
  taskId?: string;
  message: string;
  data?: unknown;
}

export interface LoggerOptions {
  level: LogLevel;
  agentId?: string;
  taskId?: string;
  logFile?: string;
  silent?: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};

const RESET_COLOR = "\x1b[0m";

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatLogLine(entry: LogEntry, useColor: boolean): string {
  const prefix = entry.agentId
    ? `[${entry.agentId}${entry.taskId ? `:${entry.taskId}` : ""}]`
    : "";

  const levelStr = entry.level.toUpperCase().padEnd(5);
  const colorStart = useColor ? LOG_LEVEL_COLORS[entry.level] : "";
  const colorEnd = useColor ? RESET_COLOR : "";

  let line = `${entry.timestamp} ${colorStart}${levelStr}${colorEnd} ${prefix} ${entry.message}`;

  if (entry.data !== undefined) {
    const dataStr =
      typeof entry.data === "string"
        ? entry.data
        : JSON.stringify(entry.data, null, 2);
    line += `\n${dataStr}`;
  }

  return line;
}

export function createLogger(options: LoggerOptions) {
  const { level, agentId, taskId, logFile, silent = false } = options;
  const minPriority = LOG_LEVEL_PRIORITY[level];

  let fileStream: fs.WriteStream | null = null;
  if (logFile) {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fileStream = fs.createWriteStream(logFile, { flags: "a" });
  }

  function log(logLevel: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVEL_PRIORITY[logLevel] < minPriority) return;

    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level: logLevel,
      agentId,
      taskId,
      message,
      data,
    };

    if (!silent) {
      const isTTY = process.stderr.isTTY ?? false;
      const line = formatLogLine(entry, isTTY);
      if (logLevel === "error" || logLevel === "warn") {
        process.stderr.write(line + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
    }

    if (fileStream) {
      const line = formatLogLine(entry, false);
      fileStream.write(line + "\n");
    }
  }

  function close(): void {
    if (fileStream) {
      fileStream.end();
      fileStream = null;
    }
  }

  return {
    debug: (message: string, data?: unknown) => log("debug", message, data),
    info: (message: string, data?: unknown) => log("info", message, data),
    warn: (message: string, data?: unknown) => log("warn", message, data),
    error: (message: string, data?: unknown) => log("error", message, data),
    close,
  };
}

export type Logger = ReturnType<typeof createLogger>;
