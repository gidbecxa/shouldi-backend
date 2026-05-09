const TRANSIENT_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "57P01",
  "57P03",
]);

const DATABASE_HINT_PATTERNS: RegExp[] = [
  /drizzlequeryerror/i,
  /failed query:/i,
  /node-postgres/i,
  /pg-pool/i,
  /postgres/i,
  /database/i,
];

const TRANSIENT_MESSAGE_PATTERNS: RegExp[] = [
  /getaddrinfo enotfound/i,
  /getaddrinfo eai_again/i,
  /connection terminated unexpectedly/i,
  /server closed the connection unexpectedly/i,
  /connection reset by peer/i,
  /connect etimedout/i,
  /connect econnrefused/i,
  /timeout expired/i,
  /the database system is starting up/i,
  /terminating connection due to administrator command/i,
];

type ErrorLike = {
  name?: string;
  message?: string;
  code?: string;
  cause?: unknown;
  stack?: string;
};

type RetryOptions = {
  label?: string;
  attempts?: number;
  delayMs?: number;
  onRetry?: (message: string) => void;
};

function asErrorLike(value: unknown): ErrorLike | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as ErrorLike;
}

function buildErrorChain(exception: unknown, maxDepth = 8): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const visited = new Set<unknown>();

  let current = asErrorLike(exception);
  let depth = 0;

  while (current && depth < maxDepth && !visited.has(current)) {
    chain.push(current);
    visited.add(current);
    current = asErrorLike(current.cause);
    depth += 1;
  }

  return chain;
}

function hasPatternMatch(texts: string[], patterns: RegExp[]) {
  return patterns.some((pattern) => texts.some((text) => pattern.test(text)));
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function isTransientDatabaseException(exception: unknown) {
  const chain = buildErrorChain(exception);
  if (chain.length === 0) {
    return false;
  }

  const texts = chain.map((item) =>
    [item.name ?? "", item.message ?? "", item.stack ?? ""].join(" "),
  );

  const hasDatabaseSignal = hasPatternMatch(texts, DATABASE_HINT_PATTERNS);
  if (!hasDatabaseSignal) {
    return false;
  }

  const hasTransientCode = chain.some((item) => {
    if (!item.code) {
      return false;
    }

    return TRANSIENT_ERROR_CODES.has(item.code.toUpperCase());
  });

  const hasTransientMessage = hasPatternMatch(texts, TRANSIENT_MESSAGE_PATTERNS);
  return hasTransientCode || hasTransientMessage;
}

export async function withTransientDatabaseRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
) {
  const attempts = Math.max(options?.attempts ?? 1, 0);
  const delayMs = Math.max(options?.delayMs ?? 100, 0);

  let lastError: unknown;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;

      if (!isTransientDatabaseException(error) || attempt >= attempts) {
        throw error;
      }

      const context = options?.label ? ` (${options.label})` : "";
      options?.onRetry?.(`Retrying transient DB error${context}; attempt ${attempt + 1}/${attempts}`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
