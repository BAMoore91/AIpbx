# Contributing to AIpbx

Thanks for your interest in improving AIpbx.

## Project layout
- `asterisk/` — Asterisk PBX core (PJSIP, dialplan, ARI, AudioSocket)
- `services/api/` — TypeScript control plane (Fastify, ARI, REST, WebSocket)
- `services/ai-engine/` — Python real-time AI voice engine (STT → Claude → TTS)
- `web/` — React admin console + WebRTC softphone
- `db/` — PostgreSQL schema
- `deploy/` — Terraform (DigitalOcean), nginx, ops scripts
- `docs/` — architecture, API, ops, security

## Development
```bash
make env      # create .env
make up       # build & run the stack
make logs     # tail logs
make test     # run service test suites
```

## Conventions
- **Multi-tenancy first.** Every query and route is tenant-scoped. Never leak
  data across tenants.
- **Secrets** come from environment; SIP/trunk credentials are encrypted at rest.
  Never commit `.env`, certs, or tfvars.
- **AI/LLM code** uses the official Anthropic SDK and the model IDs configured in
  `.env` (default `claude-opus-4-8`; `claude-haiku-4-5` for lowest voice latency).
- Keep PRs focused. Add/adjust tests. Run `make test` before opening a PR.
- Conventional-commit-style messages are appreciated (`feat:`, `fix:`, `docs:`).

## Reporting security issues
See [`docs/SECURITY.md`](docs/SECURITY.md). Please disclose responsibly rather
than opening a public issue for sensitive vulnerabilities.
