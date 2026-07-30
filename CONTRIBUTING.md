# Contributing to JoeSSH

Thank you for your interest in contributing to JoeSSH! This guide will help you get started.

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start development: `npm run dev`

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed system design overview, data flow diagrams, and security architecture.

```
atlasterm/
├── apps/
│   ├── desktop/     # React + TypeScript desktop workbench
│   ├── mobile/      # React Native/Expo mobile companion
│   └── web/         # Team/admin console
├── packages/
│   ├── error-monitor/  # Lightweight error monitoring
│   ├── i18n/          # Internationalization (15 locales)
│   └── ui/            # Shared design tokens and primitives
├── crates/
│   └── core/        # Rust domain and service interfaces
├── services/
│   └── sync/        # Rust Axum sync service
└── tests/
    └── e2e/         # Playwright acceptance tests
```

## Development Workflow

### Branch Naming

- `feat/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation
- `refactor/` — Code refactoring
- `test/` — Adding tests
- `chore/` — Maintenance tasks

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
refactor: improve code structure
test: add unit tests
chore: update dependencies
```

### Code Quality

Pre-commit hooks run automatically on `git commit`:

- **TypeScript/TSX**: ESLint fixes + related Vitest tests
- **JSON**: Prettier formatting

### Testing

```bash
# Unit tests (all workspaces)
npm run test

# Unit tests with coverage
npx vitest run --coverage

# Type checking
npm run typecheck

# E2E tests
npm run qa:e2e

# Full QA suite
npm run qa
```

#### Coverage Thresholds

The following minimums are enforced in CI and must not decrease:

| Metric     | Threshold |
| ---------- | --------- |
| Statements | 100%      |
| Branches   | 100%      |
| Functions  | 100%      |
| Lines      | 100%      |

Current coverage: **100%** across all metrics. When adding new code, include tests that cover the happy path and all edge cases. Use `/* v8 ignore next */` annotations only for confirmed V8 coverage instrumentation limitations (e.g., default parameter ternaries evaluated at module load time).

#### Test Organization

- **Unit tests**: Co-located with source (`*.test.ts` next to `*.ts`)
- **E2E tests**: `tests/e2e/` using Playwright
- **Mobile tests**: `apps/mobile/test/` with react-test-renderer

### Accessibility

All UI changes must maintain accessibility standards:

- Use semantic HTML elements
- Include ARIA labels and descriptions
- Ensure keyboard navigation works
- Maintain color contrast ratios (WCAG AA)
- Test with screen readers

### Internationalization

When adding new UI text:

1. Add keys to `packages/i18n/src/locales/en.ts`
2. Run `npm run qa:i18n-release` to verify completeness
3. Translations for other locales are managed separately

## Error Monitoring

JoeSSH includes a lightweight error monitoring package (`@atlasterm/error-monitor`):

- Captures unhandled errors and promise rejections
- Queues reports and flushes periodically
- Uses `navigator.sendBeacon` when available
- Falls back to `fetch` with `keepalive: true`

When adding error handling:

- Use try/catch blocks for expected errors
- Log unexpected errors to the error monitor
- Provide user-friendly error messages
- Include context for debugging

## Performance Budgets

Performance is enforced via Lighthouse CI and bundle size checks:

- **Performance**: ≥ 0.95
- **Accessibility**: ≥ 1.0
- **Best Practices**: ≥ 1.0
- **SEO**: ≥ 0.95
- **Bundle Size**: ≤ 250KB per chunk

When adding new code:

- Monitor bundle size impact
- Use code splitting for large features
- Optimize images and assets
- Minimize third-party dependencies

## Security

### Reporting Vulnerabilities

Read [SECURITY.md](SECURITY.md) and use the
[GitHub private vulnerability reporting form](https://github.com/JoeWorkspace/JoeSSH/security/advisories/new).
Do not include vulnerability details, exploit steps, credentials, private keys,
tokens, host information, or other sensitive data in a public issue, pull
request, or discussion.

### Security Guidelines

- Never commit secrets or credentials
- Use environment variables for configuration
- Follow the principle of least privilege
- Validate all user inputs
- Use parameterized queries for database operations
- Enable Content Security Policy headers
- Use Subresource Integrity for external scripts
- Implement proper CORS policies
- Use HTTPS for all external requests
- Sanitize user-generated content
- Use prepared statements for database queries

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run the full test suite: `npm run qa`
4. Update documentation if needed
5. Submit a pull request
6. Address code review feedback

### PR Requirements

- All tests must pass
- TypeScript compilation must succeed
- Code coverage should not decrease
- Accessibility standards must be maintained
- Security best practices must be followed

## Code Style

### TypeScript

- Use strict TypeScript configuration
- Prefer interfaces over type aliases for object shapes
- Use explicit return types for public functions
- Avoid `any` types — use `unknown` and type guards
- No non-null assertions — use optional chaining (`?.`) and nullish coalescing (`??`)
- No unused variables or imports (ESLint enforced)
- No `console.log` in production code (use `console.warn` or `console.error` only)

### React

- Use functional components with hooks
- Prefer composition over inheritance
- Use React.memo() for expensive renders
- Keep components small and focused

### Rust

- Follow standard Rust naming conventions
- Use `clippy` for linting
- Write documentation comments for public APIs
- Include unit tests for all public functions

## Getting Help

- Check existing issues and discussions
- Join our community chat (coming soon)
- Read the documentation
- Ask questions in pull requests

## License

By contributing to JoeSSH, you agree that your contributions will be licensed under the MIT License.
