# Tessera Control Plane

NestJS backend for the hosted Tessera control plane. It owns organizations,
projects (tenants), policy lifecycle, bundle distribution and redacted
telemetry. It never participates in the proxy request path.

## Development

```bash
cp .env.example .env
npm install
npm run start:dev
```

The API is available at `http://localhost:5000/api/v1`. Swagger is available
at `http://localhost:5000/api/v1/docs` when `SWAGGER_ENABLED=true`.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

## No automated tests

Do not create unit, integration, end-to-end or contract tests for this backend.
Do not add test runners, test dependencies, test scripts or `*.spec.ts` files.
This is an intentional project constraint to reduce token usage during the
current implementation phase. Validate changes with linting, type checking,
building and focused manual checks instead. Only restore automated tests after
an explicit project decision changes this rule.

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the domain and
delivery plan.
