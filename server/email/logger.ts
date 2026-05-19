/**
 * Email module — structured logger.
 *
 * Single-line JSON output so Railway / any future log aggregator can parse it.
 * Always tagged source=email so the email module's logs are easy to filter.
 *
 * Use `withContext` to attach church/member context to a sub-logger. This is
 * the foundation for SOC 2-friendly audit logging in Phase D.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context: LogContext) {
  const line = {
    ts: new Date().toISOString(),
    source: "email",
    level,
    message,
    ...context,
  };
  // Single-line JSON; stderr for warn/error so Railway flags them.
  const stream = level === "warn" || level === "error" ? console.error : console.log;
  try {
    stream(JSON.stringify(line));
  } catch {
    // If context contains a circular structure, fall back to a safe string.
    stream(JSON.stringify({ ts: line.ts, source: "email", level, message, contextErr: "unserializable" }));
  }
}

export interface EmailLogger {
  debug: (message: string, context?: LogContext) => void;
  info:  (message: string, context?: LogContext) => void;
  warn:  (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  withContext: (extra: LogContext) => EmailLogger;
}

function buildLogger(baseContext: LogContext): EmailLogger {
  return {
    debug: (m, c) => emit("debug", m, { ...baseContext, ...(c || {}) }),
    info:  (m, c) => emit("info",  m, { ...baseContext, ...(c || {}) }),
    warn:  (m, c) => emit("warn",  m, { ...baseContext, ...(c || {}) }),
    error: (m, c) => emit("error", m, { ...baseContext, ...(c || {}) }),
    withContext: (extra) => buildLogger({ ...baseContext, ...extra }),
  };
}

export const logger: EmailLogger = buildLogger({});
