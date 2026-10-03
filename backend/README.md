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

The dashboard API accepts Auth0-issued bearer access tokens. Configure the
issuer, API audience and MongoDB connection using `.env.example`. MongoDB must
run as a replica set because administrative mutations and their audit entries
are committed in one transaction.

Collector and deployment credentials are opaque machine keys whose plaintext
is returned only at creation or rotation. Configure Redis for distributed rate
limits and provide a stable `API_KEY_HASH_SECRET`; changing that secret
invalidates existing keys. The Redis failure posture is intentionally required
and has no default. Generate the HMAC secret independently for each deployment,
for example with a cryptographically secure secret manager.

Policy imports use the versioned `tessera.policy/v1` contract. Imported content
is immutable and content-addressed; compilation, approval or rejection, and
activation are separate audited transitions. Activation selects a policy for a
tenant but does not distribute a signed bundle until Phase 4.

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
