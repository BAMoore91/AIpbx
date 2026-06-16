import type { AppConfig } from './config.js';
import { Crypto } from './crypto.js';
import { JwtService } from './auth/jwt.js';
import { AuthService } from './auth/service.js';
import { S3Service } from './services/s3.js';
import { EmailService } from './services/email.js';
import { WebhookDispatcher } from './services/webhooks.js';
import { AiEngineClient } from './services/ai-engine.js';

/**
 * Process-wide singletons, wired once at boot and shared by routes, the ARI
 * controller, and the WS hub. Decorated onto the Fastify instance as `ctx`.
 */
export interface AppContext {
  config: AppConfig;
  crypto: Crypto;
  jwt: JwtService;
  auth: AuthService;
  s3: S3Service;
  email: EmailService;
  webhooks: WebhookDispatcher;
  aiEngine: AiEngineClient;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export function buildContext(config: AppConfig): AppContext {
  const crypto = new Crypto(config.encryptionKey);
  const jwt = new JwtService(
    config.jwt.accessSecret,
    config.jwt.refreshSecret,
    config.jwt.accessTtl,
    config.jwt.refreshTtl,
  );
  const auth = new AuthService(jwt, (v) => crypto.tryDecrypt(v));
  const s3 = new S3Service(config.s3);
  const email = new EmailService(config.smtp);
  const webhooks = new WebhookDispatcher((v) => crypto.tryDecrypt(v));
  const aiEngine = new AiEngineClient(config.aiEngineUrl, config.internalApiKey);

  return { config, crypto, jwt, auth, s3, email, webhooks, aiEngine };
}
