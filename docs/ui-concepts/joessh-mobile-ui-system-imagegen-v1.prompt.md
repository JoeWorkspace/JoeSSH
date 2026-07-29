# JoeSSH Mobile UI System — ImageGen v1

- Mode: built-in `image_gen`
- Use case: `ui-mockup`
- Final asset: `joessh-mobile-ui-system-imagegen-v1.png`
- Generated: 2026-07-29

## Reference images

1. `joessh-ui-masterboard-imagegen-v1.png` — authoritative Dark visual language.
2. `joessh-ui-masterboard-imagegen-light-v1.png` — authoritative Light visual language.
3. `mobile-web-visual-zh-CN-mobile-web-visual-win32.png` — real Simplified Chinese mobile information architecture.
4. `mobile-web-visual-en-mobile-web-visual-win32.png` — real English mobile responsive proportions.

## Base generation prompt

```text
Use case: ui-mockup
Asset type: JoeSSH Mobile production UI system board for long-term design specification
Primary request: Create one exceptionally polished, implementation-ready 16:9 landscape UI system board dedicated only to JoeSSH Mobile. It must define the complete responsive mobile experience across Light and Dark themes, widths 320 / 390 / 430 / 768, Arabic RTL mirroring, safe areas, and all critical sync states. This is a straight-on product design board, not concept art.

Input images:
- Image 1: dark cross-platform masterboard; use only as the authoritative dark visual language and JoeSSH brand direction.
- Image 2: light cross-platform masterboard; use only as the authoritative light visual language.
- Image 3: actual Simplified Chinese mobile baseline; preserve its real information architecture and practical card hierarchy.
- Image 4: actual English mobile baseline; preserve its responsive proportions and content hierarchy.
Do not copy the magenta test-placeholder rectangle from Images 3 or 4; replace that region with deliberate whitespace or useful UI.

Canvas and composition:
- 16:9 landscape, straight-on orthographic design board on a quiet neutral studio canvas.
- No physical phone bodies, no hands, no perspective, no tilted mockups. Use crisp borderless application-screen frames with subtle 1px outlines and soft elevation only.
- Top row: two dominant complete phone screens side by side — a 390px Light idle/registration experience and a 430px Dark ready experience — plus one wide 768px Light tablet screen demonstrating a genuine two-column responsive layout.
- Bottom row: compact but readable screen slices and component/state panels demonstrating 320px registering, Dark offline fallback, unauthorized access, fatal error/reload, safe-area behavior, language selection, and Arabic RTL mirroring. Keep every panel aligned to a strict 8pt grid with generous breathing room.
- Make the visual hierarchy legible at a glance. The board should feel like a premium enterprise developer tool, restrained and durable rather than trendy.

Product architecture to show across the board:
- Branded header with terminal mark, JoeSSH identity, title area, language selector, and proper top safe-area inset.
- Prominent sync status card.
- Primary registration/pull action.
- Three compact metric cards with semantic accent rules.
- Device registration details.
- Pull preview with a dark terminal surface in BOTH Light and Dark themes.
- Emergency connection routes with clear availability status.
- Tablet 768 layout must switch from the phone stack into a balanced two-column content grid.
- Arabic RTL example must be visibly mirrored: right-aligned brand/title, reversed icon-and-copy ordering, reversed status accent edge, mirrored metric order and two-column flow, with an accurate “العربية” language chip.

State coverage, represented primarily with universally clear icons and semantic color rather than extra words:
- idle: warm amber leading edge, calm empty values;
- registering: blue progress indicator and disabled action;
- ready: emerald confirmation and populated metrics/device/route data;
- offline: amber warning, cached context retained, route cards still available;
- unauthorized: restrained red lock/identity warning;
- fatal error: focused red error boundary card with a circular reload icon and no destructive visual drama.

Style/medium: shippable high-fidelity native mobile product UI; precise typography, practical touch targets, consistent component anatomy, immaculate spacing; no illustration and no decorative hero art.
Color palette:
- Light: cool white and mist-gray canvas, white cards, graphite typography, subtle blue-gray borders, emerald primary actions.
- Dark: deep blue-black canvas, slightly lifted charcoal-teal cards, cool gray text, restrained emerald accents.
- Semantic accents: emerald ready, amber offline/idle, blue busy, red unauthorized/error, violet only as a tiny metric accent.
- Terminal preview remains deep inky navy-black in every theme with sparse authentic monospace lines and tiny red/amber/green window dots.

Text (verbatim): Render only the following readable product labels, spelled exactly, with no substitutions and no random copy: “JoeSSH”, “同步与应急访问”, “注册并拉取预览”, “设备注册”, “拉取预览”, “应急连接”, and the Arabic locale chip “العربية”. It is acceptable to repeat these exact labels where necessary. Represent all other content through icons, numbers, status dots, short neutral lines, and UI structure; do not invent other readable words.

Constraints:
- Visibly cover 320, 390, 430 and 768 behavior in one coherent board.
- Both Light and Dark themes must feel equally complete, accessible, and first-class.
- Preserve realistic mobile safe areas and minimum 44px touch targets.
- Keep borders quiet, radii consistent, density professional, and contrast WCAG-minded.
- No crop at canvas edges. No watermark, no signatures, no annotations outside the product screens.

Avoid: random or garbled text, fake Chinese, incorrect Arabic, excess microcopy, cyberpunk styling, gaming HUD motifs, neon glow, glassmorphism, skeuomorphism, giant gradients, exaggerated shadows, physical device chrome, perspective, floating 3D objects, visual clutter, or the magenta reference placeholder.
```

## Targeted typography-cleanup edit

```text
Use case: precise-object-edit
Asset type: JoeSSH Mobile UI system board, typography cleanup only
Primary request: Edit the immediately previous generated JoeSSH Mobile system board. Change only the readable text cleanup; preserve every screen frame, layout, component, icon, spacing, theme color, responsive arrangement, state, terminal preview, safe-area visualization, and RTL mirroring exactly as they are.

Typography cleanup:
- Remove every caption, heading, width label, theme label, or state label that sits OUTSIDE the application screen frames, including the top-left board title and all English captions above the top and bottom frames. Leave the surrounding neutral canvas clean and blank.
- Inside the application screens, preserve these readable labels exactly wherever present: “JoeSSH”, “同步与应急访问”, “注册并拉取预览”, “设备注册”, “拉取预览”, “应急连接”, and “العربية”.
- Replace any other readable words inside the application screens, including English theme/language/state words and extra Chinese microcopy, with short neutral non-text skeleton lines, icons, numbers, or status dots. Do not create new words.
- Keep numeric data and the time “9:41”.

Critical invariants:
- Keep the 390 Light phone, 430 Dark phone, 768 Light tablet two-column layout, 320 registering slice, Dark offline slice, unauthorized slice, fatal error slice, safe-area example, language-selector example, and Arabic RTL mirrored phone all in the same positions and proportions.
- Keep all Dark and Light styling unchanged.
- Keep the Arabic RTL phone visibly mirrored and keep “العربية” spelled accurately.
- Keep terminal previews dark in every theme.
- Do not crop, redesign, recolor, reorder, add annotations, add a watermark, or alter the existing high-fidelity product UI.
```
