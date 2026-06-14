/**
 * Minimal pluggable logger, modelled on the tiagosiebler connector style.
 * Pass your own implementation via the client options to integrate with
 * winston/pino/etc, or silence output entirely.
 */
export interface Logger {
  trace: (...params: unknown[]) => void;
  info: (...params: unknown[]) => void;
  error: (...params: unknown[]) => void;
  warn: (...params: unknown[]) => void;
}

export const DefaultLogger: Logger = {
  /* eslint-disable no-console */
  trace: () => {},
  info: (...params) => console.info(...params),
  warn: (...params) => console.warn(...params),
  error: (...params) => console.error(...params),
};

/** A logger that swallows everything. */
export const SilentLogger: Logger = {
  trace: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
