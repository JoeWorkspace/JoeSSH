# JoeSSH ImageGen UI Reference Catalog

Status: visual direction for the versioned Desktop, Web Admin, and Mobile UI
system.

## Masterboards

- `joessh-ui-masterboard-imagegen-v1.png`: cross-platform Dark direction.
- `joessh-ui-masterboard-imagegen-light-v1.png`: cross-platform Light
  direction.

## Product System Boards

- `joessh-desktop-ui-system-imagegen-v1.png`: Desktop workbench, responsive
  compositions, feature surfaces, and operational states in Dark and Light.
- `joessh-web-admin-ui-system-imagegen-v1.png`: Web Admin wide/mobile
  compositions, data views, and boundary states in Dark and Light.
- `joessh-mobile-ui-system-imagegen-v1.png`: Mobile phone/tablet,
  narrow-screen, RTL, sync, emergency, and recovery states in Dark and Light.

Every PNG has a sibling `.prompt.md` file containing the exact built-in
ImageGen prompt used to produce it.

## Usage Contract

These boards define visual intent: brand character, hierarchy, density,
surface treatment, state visibility, and cross-platform family resemblance.
They are not runtime assets and must not be sliced into the product.

Production tokens, component behavior, responsive rules, accessibility
semantics, and acceptance viewports remain defined by `../ui-system.md`, the
source code, and automated tests. Any visual change adopted from a board must
be implemented as semantic tokens or components and protected by a relevant
test or visual baseline.

Future concepts should be added as versioned siblings instead of overwriting an
approved board. Their exact prompts must be stored beside them so the direction
can be reproduced and audited.
