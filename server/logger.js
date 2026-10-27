import pino from 'pino';
import pretty from 'pino-pretty';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// In-process pretty stream (no worker thread): pino transports run in a worker, and
// `node --watch` posts messages from workers that thread-stream treats as fatal.
const stream = isDev && !isTest ? pretty({ colorize: true }) : undefined;

const logger = pino({ level: isTest ? 'silent' : 'info' }, stream);

export default logger;
