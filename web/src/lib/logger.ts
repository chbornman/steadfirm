/**
 * Structured logger for the web frontend.
 *
 * Outputs structured JSON-like objects to the console during development.
 * Each log entry includes a timestamp, level, message, and optional context fields.
 *
 * Usage:
 *   import { log } from '@/lib/logger';
 *   log.info('user loaded', { userId: '123', services: { photos: true } });
 *   log.warn('provisioning incomplete', { missing: ['paperless'] });
 *   log.error('api request failed', { url: '/api/v1/photos', status: 503, body: '...' });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };

  switch (level) {
    case 'debug':
      console.debug('[sf]', entry);
      break;
    case 'info':
      console.info('[sf]', entry);
      break;
    case 'warn':
      console.warn('[sf]', entry);
      break;
    case 'error':
      console.error('[sf]', entry);
      break;
  }
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
