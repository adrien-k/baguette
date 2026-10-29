import pino from 'pino';
import pinoPretty from 'pino-pretty';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// Pretty-print in-process rather than via `transport`: the transport runs in a worker thread
// (thread-stream), and when that worker dies the unhandled 'error' event takes the whole server down.
const stream = isDev && !isTest ? pinoPretty({ colorize: true, sync: true }) : undefined;

// `LOG_LEVEL=debug` turns on verbose diagnostics (e.g. every inbound Slack event).
const level = isTest ? 'silent' : process.env.LOG_LEVEL || 'info';

const logger = pino({ level }, stream);

export default logger;
