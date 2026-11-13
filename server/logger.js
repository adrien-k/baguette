import pino from 'pino';
import pretty from 'pino-pretty';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// `LOG_LEVEL=debug` turns on verbose diagnostics (e.g. every inbound Slack event).
const level = isTest ? 'silent' : process.env.LOG_LEVEL || 'info';

function createLogger() {
  if (isTest) {
    return pino({ level });
  }
  if (isDev) {
    // Destination stream, not `transport`: pino-pretty's worker thread races
    // `node --watch` restarts (thread-stream: "this should not happen: undefined").
    return pino({ level }, pretty({ colorize: true }));
  }
  return pino({ level });
}

const logger = createLogger();

export default logger;
