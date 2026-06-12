import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'password_hash',
      'sip_password',
      'secret',
      '*.secret',
      'token',
    ],
    censor: '[redacted]',
  },
  base: { service: 'aipbx-api' },
});

export type Logger = typeof logger;
