# JoeSSH Desktop UI System — ImageGen Prompt v1

Mode: built-in `image_gen`

```text
Use case: ui-mockup
Asset type: high-fidelity desktop product UI system board for permanent JoeSSH design direction
Primary request: Create one polished, production-realistic Desktop UI system sheet for JoeSSH. It must present the same desktop workbench in Dark and Light themes side by side, plus compact functional and state panels that cover the complete desktop product.
Input images: Image 1: actual wide Desktop screenshot and authoritative information-architecture reference; Image 2: actual narrow responsive Desktop screenshot and authoritative responsive-behavior reference; Image 3: JoeSSH dark visual-language reference; Image 4: JoeSSH light visual-language reference. Use the structure from Images 1–2 and the refined visual system from Images 3–4. Do not copy the web-admin or mobile layouts from the masterboards.
Scene/backdrop: clean neutral design-review canvas with very subtle cool gray or deep ink framing, no environmental scene.
Style/medium: shippable enterprise desktop app UI, premium restrained product design, crisp 1px borders, 8px grid, compact but readable typography, refined spacing, subtle depth, emerald green accent, no concept-art treatment.
Composition/framing: exact 16:9 landscape, straight-on orthographic design board, no perspective and no device shell. Top two-thirds: two equal large desktop workbench frames, Dark on the left and Light on the right, with identical geometry and information hierarchy. Each frame shows a connection-library sidebar, top workspace bar, session tabs, two-way split terminal, right Inspector/product-navigation rail, and bottom connection status bar. Both themes keep the terminal panes deep near-black with realistic monospace rows. Bottom third: a clean aligned strip of compact detail crops showing (1) narrow responsive layout with stacked terminals and details moved below, (2) new/edit connection modal with fields and authentication selector, (3) command palette with searchable actions, (4) SFTP two-pane transfer view, (5) team access and role controls, port-forwarding routes, and settings controls, (6) a status/component matrix for connecting, connected, offline, error, and disabled states using clear icon/color treatment.
Functional coverage: connection library with search, tags, groups, favorites and host rows; terminal tabs, split control, search and recording controls; contextual Inspector cards; SFTP; team access; port forwarding; settings; new and edit connection flows; command palette; connecting, connected, offline, error, disabled states. Make every function recognizable through familiar UI patterns and iconography.
Theme system: Dark uses deep blue-black surfaces, low-glare slate panels, emerald focus states and precise cool-gray borders. Light uses cool white and mist-gray surfaces with the same spacing, shape, typography and emerald accent. The two themes must be clearly isomorphic, not redesigned independently. Terminal content remains dark in both themes.
Text (verbatim): render only these necessary product labels, spelled exactly: "JoeSSH", "工作台", "终端", "SFTP", "团队", "端口转发", "设置". They may repeat once per theme where required by the mirrored UI. Do not invent any other readable words; represent secondary content as tasteful short data rows, icons, neutral glyphs, numbers, or subtle placeholder lines.
Constraints: highly legible at presentation scale; complete but uncluttered; preserve the real JoeSSH desktop information architecture; clear visual distinction between active, hover, selected, warning and disabled states; consistent corner radii and component density; no watermark.
Avoid: random or malformed text, fake branding, logos beyond the simple JoeSSH terminal mark, cyberpunk styling, gaming HUDs, neon bloom, excessive gradients, glassmorphism, oversized marketing typography, illustration, perspective mockups, device frames, people, decorative 3D objects, visual noise.
```

Built-in ImageGen reference inputs:

- `tests/e2e/specs/visual-qa.spec.ts-snapshots/desktop-desktop-visual-wide-zh-CN-desktop-visual-wide-win32.png`
- `tests/e2e/specs/visual-qa.spec.ts-snapshots/desktop-desktop-visual-narrow-zh-CN-desktop-visual-narrow-win32.png`
- `docs/ui-concepts/joessh-ui-masterboard-imagegen-v1.png`
- `docs/ui-concepts/joessh-ui-masterboard-imagegen-light-v1.png`
