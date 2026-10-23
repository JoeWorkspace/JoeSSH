# JoeSSH Web Admin UI System Board — ImageGen Prompt

Mode: built-in `image_gen`

Use case: `ui-mockup`

## Reference images

1. `joessh-ui-masterboard-imagegen-v1.png` — approved dark cross-platform visual language
2. `joessh-ui-masterboard-imagegen-light-v1.png` — approved light cross-platform visual language
3. `web-admin-web-admin-visual-wide-zh-CN-web-admin-visual-wide-win32.png` — actual production wide Chinese layout
4. `web-admin-web-admin-visual-mobile-zh-CN-web-admin-visual-mobile-win32.png` — actual production mobile Chinese responsive reflow
5. `web-admin-web-admin-visual-wide-en-web-admin-visual-wide-win32.png` — actual production wide English typography and layout

The matching English mobile snapshot was inspected separately to verify that it follows the same responsive behavior.

## Final prompt

```text
Use case: ui-mockup
Asset type: final, production-grade JoeSSH Web Admin UI system board for design handoff
Primary request: Create one exceptionally polished high-fidelity Web Admin UI system board that permanently defines the product across dark and light themes, desktop and mobile responsive layouts, all essential features, components, and critical states.
Input images: Image 1 is the approved dark JoeSSH cross-platform masterboard and is the dark visual-language reference. Image 2 is the approved light masterboard and is the light visual-language reference. Images 3 and 5 are the actual production wide Web Admin screenshots in Chinese and English and define information architecture, density, hierarchy, sidebar navigation, dashboard cards, tables, audit stream, spacing, and typography. Image 4 is the actual production Chinese mobile screenshot and defines the real mobile reflow; its English mobile companion was inspected separately and confirms the same responsive behavior. Generate a new dedicated Web Admin system board; do not merely collage or copy the reference images.
Scene/backdrop: a clean exact 16:9 landscape design-system canvas, straight-on orthographic view, edge-to-edge product-design presentation, no perspective and no physical device mockups.
Subject: Two dominant wide Web Admin dashboard compositions across the upper two-thirds, one dark and one light, clearly the same responsive product. Each shows the ready team-operations dashboard with compact navigation, health and summary metrics, filter and search controls, member and role data, device inventory and status, audit activity, storage usage, and sync controls. The lower third contains two flat borderless mobile responsive screen crops, dark and light, plus a disciplined component-and-state matrix. Mobile tables must reflow into labeled vertical cards and lists rather than squeeze columns, and navigation must collapse cleanly. The component matrix includes search, select, segmented control, tabs, checkboxes, pagination, buttons, chips, compact data rows, filter controls, and focus, hover, selected treatments. The state matrix visibly communicates loading with skeletons, authentication and authorization with lock or keyhole, empty data, error, disabled, offline, and healthy or ready states through layout, icons, tone, and status color, without extra prose.
Style/medium: realistic shippable enterprise product UI, refined contemporary B2B operations console, not concept art. Preserve the JoeSSH visual DNA from Images 1 and 2: deep ink and navy chrome, cool white and pearl surfaces, restrained emerald and sea-glass accent, hairline borders, crisp sans-serif typography, precise optical alignment, strong accessible contrast, calm data density, subtle depth, and premium craft. Dark theme uses near-black navy surfaces with low-glare cards and restrained emerald focus; light theme uses cool-white surfaces with graphite text and sea-glass accents. The two themes must feel token-equivalent, not separate designs.
Composition/framing: exact 16:9 wide board. Use a rigorous 12-column grid and generous outer margin. Make both desktop dashboards large enough to read at a glance, with the light and dark variants balanced equally. Use the bottom strip for flat mobile crops and organized states and components; no overlapping panels, no cropped navigation, no tiny decorative miniature screens. Show responsive continuity clearly.
Color palette: near-black ink #06151A, deep navy #0A2025, cool white #F7FAFA, pearl #FFFFFF, graphite #12252B, sea-glass emerald #00A982 and #14B89A, pale mint surfaces, muted blue-gray dividers. Use amber only for warning and restrained coral only for destructive or error. No purple neon.
Text (verbatim): Render only these product labels, each spelled exactly and cleanly where needed: "JoeSSH", "团队运营", "同步", "设备", "团队", "审计", "存储". Do not invent any other words, sentences, pseudo-Chinese, lorem ipsum, random glyphs, or extra headings. Use numerals, icons, avatars, status dots, and short neutral typographic bars for secondary data so the board stays legible without gibberish.
Functional coverage: ready dashboard; team members and roles; device inventory; audit timeline; storage usage; sync status and controls; filter, search, and navigation patterns; responsive mobile data cards; loading, authentication and authorization, empty, error, disabled, offline, and healthy or ready states.
Constraints: exact straight-on product UI board; dark and light both present and equally complete; desktop and mobile both present; every control looks implementable; consistent spacing, radii, border, shadow, type, and status-token logic; preserve the real production information architecture from Images 3 through 5; no logos except the text brand JoeSSH; no watermark.
Avoid: perspective, tilted screens, laptop or phone hardware frames, hands, people, rooms, glossy marketing mockups, cyberpunk aesthetics, gaming HUD, excessive glow, frosted-glass blur, illegible microtext, dense decorative noise, random charts, arbitrary gradients, mismatched themes, duplicated navigation, fake browser chrome, watermarks, and any text beyond the seven exact labels.
```
