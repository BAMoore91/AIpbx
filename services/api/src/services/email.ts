import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

/**
 * SMTP email sender, primarily for voicemail-to-email notifications. If SMTP is
 * unconfigured, sends are logged and skipped (no crash in dev).
 */
export class EmailService {
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(cfg: AppConfig['smtp']) {
    this.from = cfg.from;
    if (cfg.host) {
      this.transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
      });
    } else {
      this.transporter = null;
      logger.warn('SMTP host not set — email delivery disabled');
    }
  }

  /** True when SMTP is configured and mail will actually be delivered. */
  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(msg: EmailMessage): Promise<void> {
    if (!this.transporter) {
      logger.info({ to: msg.to, subject: msg.subject }, 'email skipped (no SMTP)');
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...msg });
  }

  async sendVoicemailNotification(params: {
    to: string;
    extension: string;
    fromNumber: string | null;
    duration: number | null;
    transcription: string | null;
    audio?: { filename: string; content: Buffer };
  }): Promise<void> {
    const dur = params.duration ? `${params.duration}s` : 'unknown length';
    const text = [
      `New voicemail for extension ${params.extension}`,
      `From: ${params.fromNumber ?? 'unknown'}`,
      `Duration: ${dur}`,
      params.transcription ? `\nTranscription:\n${params.transcription}` : '',
    ].join('\n');
    await this.send({
      to: params.to,
      subject: `New voicemail from ${params.fromNumber ?? 'unknown'}`,
      text,
      attachments: params.audio
        ? [{ filename: params.audio.filename, content: params.audio.content, contentType: 'audio/wav' }]
        : undefined,
    });
  }
}
