// 分级日志：debug/info/warn/error + ISO 时间戳，便于 PM2 日志排查。
// 级别经 LOG_LEVEL 环境变量控制（默认 info）。

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return (["debug", "info", "warn", "error"].includes(raw) ? raw : "info") as LogLevel;
}

class Logger {
  private level: LogLevel = resolveLevel();

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private write(level: LogLevel, message: string, extra?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${LEVEL_TAG[level]}] ${message}`;
    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (extra !== undefined) sink(line, extra);
    else sink(line);
  }

  debug(message: string, extra?: unknown): void {
    this.write("debug", message, extra);
  }
  info(message: string, extra?: unknown): void {
    this.write("info", message, extra);
  }
  warn(message: string, extra?: unknown): void {
    this.write("warn", message, extra);
  }
  error(message: string, extra?: unknown): void {
    this.write("error", message, extra);
  }
}

export const logger = new Logger();
