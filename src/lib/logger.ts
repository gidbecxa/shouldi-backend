export const logger = {
  info: (message: string, data?: unknown) => console.log(message, data ?? ""),
  warn: (message: string, data?: unknown) => console.warn(message, data ?? ""),
  error: (message: string, data?: unknown) => console.error(message, data ?? ""),
};
