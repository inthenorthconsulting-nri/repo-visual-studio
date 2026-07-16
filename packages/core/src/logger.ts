/* eslint-disable no-console */
export type LogLevel = "info" | "warn" | "error" | "debug";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export function createLogger(verbose = false): Logger {
  return {
    info: (message: string) => console.log(`[rvs] ${message}`),
    warn: (message: string) => console.warn(`[rvs] warn: ${message}`),
    error: (message: string) => console.error(`[rvs] error: ${message}`),
    debug: (message: string) => {
      if (verbose) console.log(`[rvs] debug: ${message}`);
    },
  };
}
