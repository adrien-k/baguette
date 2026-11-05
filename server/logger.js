import pino from 'pino';
import pretty from 'pino-pretty';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

function createLogger() {
  if (isTest) {
    return pino({ level: 'silent' });
  }
  if (isDev) {
    // Destination stream, not `transport`: pino-pretty's worker thread races
    // `node --watch` restarts (thread-stream: "this should not happen: undefined").
    return pino({ level: 'info' }, pretty({ colorize: true }));
  }
  return pino({ level: 'info' });
}

const logger = createLogger();

export default logger;
