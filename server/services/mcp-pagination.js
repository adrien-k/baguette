/** Maximum bytes per request when startByte and endByte are both provided. */
export const MAX_LOG_RANGE_BYTES = 5000;

/** Default tail size when no byte range is specified. */
export const DEFAULT_LOG_BYTES = MAX_LOG_RANGE_BYTES;

/**
 * @param {number} index
 * @param {number} totalBytes
 * @returns {number}
 */
export function toAbsoluteByteIndex(index, totalBytes) {
  return index >= 0 ? index : totalBytes + index;
}

/**
 * @param {{ startByte?: number, endByte?: number }} [options]
 * @returns {string|null} Error message, or null if valid.
 */
export function validateLogByteRange({ startByte, endByte } = {}) {
  if (startByte != null && startByte < 0 && endByte != null && endByte >= 0) {
    return 'Cannot combine a negative startByte with a non-negative endByte';
  }
  return null;
}

/**
 * True when the range must be applied after a full log download (negative endByte, or both bounds negative).
 *
 * @param {{ startByte?: number, endByte?: number }} [options]
 * @returns {boolean}
 */
export function rangeNeedsFullLogFetch({ startByte, endByte } = {}) {
  if (endByte != null && endByte < 0) return true;
  if (startByte != null && endByte != null && startByte < 0) return true;
  if (endByte == null && startByte != null) return true;
  return false;
}

function spanFromStartToEof(start, totalBytes) {
  return totalBytes - start;
}

/**
 * When endByte is omitted: read max(MAX_LOG_RANGE_BYTES, remaining bytes from start through EOF).
 *
 * @param {number} start
 * @param {number} lastIndex
 * @param {number} totalBytes
 * @returns {number} inclusive end index
 */
function defaultEndFromStart(start, lastIndex, totalBytes) {
  const remaining = spanFromStartToEof(start, totalBytes);
  const span = Math.max(MAX_LOG_RANGE_BYTES, remaining);
  return Math.min(lastIndex, start + span - 1);
}

function capExplicitRangeEnd(start, end, lastIndex) {
  const maxEnd = Math.min(lastIndex, start + MAX_LOG_RANGE_BYTES - 1);
  return Math.min(end, maxEnd);
}

/**
 * Resolve inclusive byte range bounds for paginated log output.
 * Negative indices count from the end of the log (-1 is the last byte).
 *
 * @param {number} totalBytes
 * @param {{ startByte?: number, endByte?: number }} [options]
 * @returns {{ start: number, end: number }}
 */
export function resolveByteRange(totalBytes, { startByte, endByte } = {}) {
  if (totalBytes === 0) {
    return { start: 0, end: 0 };
  }
  const lastIndex = totalBytes - 1;

  if (startByte == null && endByte == null) {
    const start = Math.max(0, totalBytes - DEFAULT_LOG_BYTES);
    return { start, end: lastIndex };
  }

  const explicitEnd = endByte != null;

  let start;
  if (startByte != null) {
    start = Math.max(0, Math.min(toAbsoluteByteIndex(startByte, totalBytes), lastIndex));
  } else {
    start = 0;
  }

  let end;
  if (explicitEnd) {
    end = Math.max(0, Math.min(toAbsoluteByteIndex(endByte, totalBytes), lastIndex));
    end = capExplicitRangeEnd(start, end, lastIndex);
  } else if (startByte != null) {
    end = defaultEndFromStart(start, lastIndex, totalBytes);
  } else {
    end = lastIndex;
  }

  if (start > end) {
    return { start, end: start - 1 };
  }
  return { start, end };
}

/**
 * Slice UTF-8 text by byte range (same semantics as PrWorkflowLogs / HTTP Range).
 *
 * @param {string} text
 * @param {{ startByte?: number, endByte?: number }} [options]
 * @returns {{ log: string, totalBytes: number, startByte: number, endByte: number }}
 */
export function sliceByteRange(text, options = {}) {
  const validationError = validateLogByteRange(options);
  if (validationError) {
    const err = new Error(validationError);
    throw err;
  }

  const buf = Buffer.from(text ?? '', 'utf8');
  const totalBytes = buf.length;
  const { start, end } = resolveByteRange(totalBytes, options);

  if (totalBytes === 0 || start > end || start >= totalBytes) {
    return { log: '', totalBytes, startByte: start, endByte: Math.max(start - 1, 0) };
  }

  const log = buf.subarray(start, end + 1).toString('utf8');
  return { log, totalBytes, startByte: start, endByte: end };
}

/**
 * Build an HTTP Range header value for GitHub Actions job logs.
 *
 * @param {{ startByte?: number, endByte?: number, totalBytes?: number }} [options]
 * @returns {string}
 */
export function buildLogRangeHeader({ startByte, endByte, totalBytes } = {}) {
  if (rangeNeedsFullLogFetch({ startByte, endByte })) {
    return 'bytes=0-';
  }

  if (totalBytes != null) {
    const { start, end } = resolveByteRange(totalBytes, { startByte, endByte });
    return `bytes=${start}-${end}`;
  }

  if (startByte == null && endByte == null) {
    return `bytes=-${DEFAULT_LOG_BYTES}`;
  }

  if (startByte != null && endByte == null) {
    if (startByte < 0) {
      const suffix = Math.min(MAX_LOG_RANGE_BYTES, -startByte);
      return `bytes=-${suffix}`;
    }
    return `bytes=${startByte}-${startByte + MAX_LOG_RANGE_BYTES - 1}`;
  }

  if (startByte != null && endByte != null && startByte >= 0 && endByte >= 0) {
    const cappedEnd = Math.min(endByte, startByte + MAX_LOG_RANGE_BYTES - 1);
    return `bytes=${startByte}-${cappedEnd}`;
  }

  return 'bytes=0-';
}
