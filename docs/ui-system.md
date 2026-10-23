# JoeSSH UI System

Status: product baseline for Desktop, Web Admin, and Mobile.

## Product Character

JoeSSH is an operational workspace, not a generic dashboard. The interface must
feel calm under pressure, dense without being cramped, and explicit about
whether data is live, sampled, offline, pending, or unavailable.

The visual language is built around:

- deep graphite and cool white surfaces;
- an emerald operational accent;
- restrained blue, amber, red, violet, and green semantic signals;
- compact typography with a dedicated terminal mono stack;
- one-pixel boundaries, soft elevation, and limited atmospheric glow;
- motion that communicates state and disappears under reduced-motion settings.

## Source Of Truth

Shared web and Desktop tokens and primitives live in:

- `packages/ui/src/styles.css`
- `packages/ui/src/primitives.tsx`

Platform-specific composition lives in:

- `apps/desktop/src/styles.css`
- `apps/web/src/styles.css`
- `apps/mobile/app/index.tsx`
- `apps/mobile/app/_layout.tsx`

The versioned ImageGen visual direction and exact generation prompts are
cataloged in `docs/ui-concepts/README.md`. Those boards define visual intent;
tokens, components, responsive behavior, accessibility semantics, and tests
remain authoritative.

New UI must consume semantic tokens. Feature code must not introduce a new
brand color, radius scale, focus treatment, or shadow without updating this
system first.

## Semantic Tokens

The `--atlas-*` token prefix is retained until the documented compatibility
migration before 1.0. It is an internal identifier, not the public brand.

Core groups:

- Surfaces: `--atlas-bg`, `--atlas-bg-soft`, `--atlas-bg-raised`,
  `--atlas-surface`, `--atlas-surface-strong`, `--atlas-surface-glass`
- Boundaries: `--atlas-border`, `--atlas-border-strong`
- Content: `--atlas-text`, `--atlas-text-muted`, `--atlas-text-faint`
- Brand: `--atlas-accent`, `--atlas-accent-strong`,
  `--atlas-accent-soft`, `--atlas-accent-contrast`
- Status: `--atlas-blue`, `--atlas-amber`, `--atlas-red`,
  `--atlas-violet`, `--atlas-green`
- Terminal: `--atlas-terminal-bg`, `--atlas-terminal-text`,
  `--atlas-mono`
- Shape: `--atlas-radius-xs` through `--atlas-radius-xl`
- Depth: `--elev-1`, `--elev-2`, `--atlas-shadow`,
  `--atlas-shadow-soft`
- Interaction: `--atlas-focus-ring`, `--dur-*`, `--ease`,
  `--ease-spring`

Light, dark, forced-colors, and reduced-motion modes are first-class variants.
An explicit `data-theme` choice always overrides `prefers-color-scheme`; new
theme rules must preserve that precedence in both tokens and component states.

## Responsive Contract

The product must remain usable from a 320 CSS-pixel mobile viewport through
ultrawide desktop displays. Display scaling is tested as the equivalent CSS
viewport, because operating-system scaling reduces the available CSS pixels.

| Physical display | Scale | Effective viewport |
| ---------------- | ----: | -----------------: |
| 1366 × 768       |  100% |         1366 × 768 |
| 1366 × 768       |  125% |         1093 × 614 |
| 1366 × 768       |  150% |          911 × 512 |
| 1920 × 1080      |  125% |         1536 × 864 |
| 1920 × 1080      |  150% |         1280 × 720 |
| 1920 × 1080      |  175% |         1097 × 617 |
| 1920 × 1080      |  200% |          960 × 540 |
| 2560 × 1440      |  150% |         1707 × 960 |
| 2560 × 1440      |  200% |         1280 × 720 |
| 3840 × 2160      |  200% |        1920 × 1080 |

Composition modes:

- `> 1240px`: three-column Desktop workbench and persistent Web Admin rail.
- `761px–1240px`: Desktop context dock below the terminal; compact Web Admin
  composition.
- `<= 760px`: single-column reading order with horizontally scrollable controls
  only where the control itself is intrinsically tabular.
- `<= 520px`: touch-first actions, collapsed data tables, and stacked forms.
- `320px`: absolute minimum; no document-level horizontal overflow.

Layouts must also work with browser zoom at 80%, 90%, 100%, 110%, 125%, 150%,
175%, and 200%. No critical action may rely on hover.

## Feature Coverage

### Desktop

- Connection library: search, tags, groups, favorites, ordering, context menu,
  new/edit/duplicate/delete, import/export, and sample/live status.
- Session workbench: connect/disconnect, terminal tabs, command input/history,
  search, recording, split view, focus mode, copy, and error feedback.
- Inspector: host facts, session context, connection statistics, and runbooks.
- SFTP: loading, disconnected, directory, upload, download, empty, and error.
- Team: access summary, requests, review, roles, shared vault, and audit events.
- Forwarding: configuration, start, stop, pending, active, and failure states.
- Settings: language, theme, telemetry, connection transfer, and known hosts.
- Overlays: onboarding, command palette, shortcuts, connection dialogs, group
  manager, confirmations, toasts, loading, and fatal error recovery.

### Web Admin

- Sync health and snapshot provenance.
- Active-member, role, device, and audit metrics.
- Member and role access models.
- Managed device status.
- Audit activity.
- Loading, authentication-required, empty, unavailable, malformed, stale, and
  ready data states.
- Language, telemetry consent, refresh, keyboard skip navigation, and printable
  output.

### Mobile

- Automatic and explicit language selection.
- Idle, registering, previewing, ready, offline, timeout, unauthorized, and
  unknown sync states.
- Device registration and connection quality.
- Pull preview and cursor context.
- Profile, session, and pending-change metrics.
- Live and offline emergency channels.
- Native safe areas, OS light/dark theme, RTL, and fatal error recovery.

## Component State Contract

Every interactive component must define:

- rest, hover, active, focus-visible, disabled, and busy states;
- light and dark theme colors;
- keyboard and touch behavior;
- localized long-label behavior;
- reduced-motion and forced-colors behavior;
- accessible name, role, state, and error association.

Status colors never stand alone: status must also be communicated by visible
text, shape, icon, or accessible state.

## Layout Rules

- Use `minmax(0, 1fr)` for shrinkable grid tracks and `min-width: 0` for
  shrinkable flex children.
- Prefer local scrolling regions over document overflow in Desktop.
- Keep primary actions at least 36 CSS pixels on Desktop and 44 CSS pixels on
  touch surfaces.
- Terminal content stays left-to-right even when the surrounding product uses
  RTL.
- Localized Web roots keep the document language synchronized with the active
  locale. Native RTL composition uses explicit row mirroring and text writing
  direction without production-only aliases or Web-invalid View styles.
- Long host names, member names, file names, endpoints, translations, and
  command text must wrap or truncate inside their own region.
- Loading skeletons preserve the final layout dimensions.
- Sample data is always visibly labeled and never styled as a live connection.

## Release Acceptance

The UI baseline is accepted only when:

1. TypeScript, unit tests, and production builds pass for all three clients.
2. Desktop, Web Admin, and Mobile E2E flows pass.
3. Scripted visual baselines pass in Chinese and English.
4. Desktop scaling checks cover 100% through 200%.
5. Web Admin covers wide and mobile navigation/table layouts.
6. Mobile covers 320px, dark OS theme, offline fallback, live sync, and Arabic.
7. Automated accessibility checks report no critical or serious violations.
8. Browser inspection finds no document-level horizontal overflow, clipped
   primary action, or console error at the acceptance viewports.
9. Production module resolution must never redirect React Native or safe-area
   packages to unit-test doubles.

Automated browser contracts currently exercise Desktop scaling through 200%,
Web Admin at 320/390/520/760/761/911/1080/1081/1440/1920 CSS pixels, and the
Mobile companion at 320/390/430/768 CSS pixels. Packaged Tauri DPI, native
mobile font scaling, platform screen readers, and device safe areas remain
required manual release checks until dedicated device runners are available.

This document is a versioned baseline. It is intended to make the UI durable,
not frozen: future feature work extends the system instead of bypassing it.
