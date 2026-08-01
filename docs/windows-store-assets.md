# Microsoft Store Asset Preparation

This workflow prepares Microsoft Store listing images without treating QA
snapshots as product screenshots. The tracked bundle at
`docs/assets/microsoft-store` is intentionally
`provisional-not-uploadable`. Its two layout references come from development
visual tests, are not scene-specific, and are not bound to a release
candidate.

The script does not upload anything to Partner Center. It also does not verify
Authenticode, Microsoft Store signing, identity, certification, or publication.
Run the existing Windows Store candidate preflight first, and use this workflow
only with the exact candidate file and its generated `candidate.json` evidence.

## Pinned Asset Set

Final screenshots are PNG files at exactly 1920 x 1080. Each locale contains
two light and two dark captures.

Final screenshot PNGs may contain only `IHDR`, `IDAT`, and `IEND` chunks. The
workflow rejects text, EXIF, ICC, timestamp, physical-dimension, APNG, private,
and unknown chunks even when their CRCs are valid. It also decompresses the
complete IDAT stream, rejects trailing compressed payloads, and verifies the
declared dimensions and every scanline filter. This prevents ancillary or
malformed image payloads from carrying data that is invisible during image
review. The script does not silently strip or rewrite screenshots, so the
recorded screenshot SHA-256 always identifies the exact bytes reviewed for
upload.

| Locale | Order | Scene                                         | Theme | Required file                                        |
| ------ | ----: | --------------------------------------------- | ----- | ---------------------------------------------------- |
| en-US  |     1 | Connected terminal using the isolated fixture | Light | `screenshots/en-US/01-connected-terminal-light.png`  |
| en-US  |     2 | Host-key fingerprint review                   | Dark  | `screenshots/en-US/02-host-key-review-dark.png`      |
| en-US  |     3 | Synthetic SFTP transfer state                 | Light | `screenshots/en-US/03-sftp-transfer-light.png`       |
| en-US  |     4 | Stopped sample port-forward rule              | Dark  | `screenshots/en-US/04-port-forward-stopped-dark.png` |
| zh-CN  |     1 | Connected terminal using the isolated fixture | Light | `screenshots/zh-CN/01-connected-terminal-light.png`  |
| zh-CN  |     2 | Host-key fingerprint review                   | Dark  | `screenshots/zh-CN/02-host-key-review-dark.png`      |
| zh-CN  |     3 | Synthetic SFTP transfer state                 | Light | `screenshots/zh-CN/03-sftp-transfer-light.png`       |
| zh-CN  |     4 | Stopped sample port-forward rule              | Dark  | `screenshots/zh-CN/04-port-forward-stopped-dark.png` |

The script also generates these opaque PNG files from
`apps/desktop/src-tauri/icons/joessh-icon-master-1024.png`:

- 1024 x 1024 `branding/joessh-box-art-1x1.png`;
- 1024 x 1536 `branding/joessh-poster-art-2x3.png`.

The generator uses only Node.js built-ins. It validates PNG chunk CRCs and
produces deterministic output under the repository's pinned Node.js runtime,
so regenerating from the same master icon yields the same SHA-256 values. Bundle
verification regenerates both brand images in memory and compares the exact
bytes; editing an image and merely updating its manifest hash is rejected.
The tracked generated `manifest.json` is intentionally listed in
`.prettierignore`: formatting it would change the bytes covered by
`SHA256SUMS.txt`. Regenerate the bundle instead of formatting its evidence.

## Capture Session

Keep the candidate, `candidate.json`, capture directory, and prepared final
bundle outside the repository until the images have passed privacy and release
review. Do not put a personal name, identity document, SSH secret, private host,
or production terminal output in these files.

The capture-session initializer, final preparation command, and final verifier
resolve filesystem links and reject capture or final-bundle paths that land
inside the repository. The tracked provisional reference bundle is the only
Store asset bundle permitted in Git history.

Initialize a new capture directory before launching the exact candidate:

```powershell
$JoeSshCandidate = "C:\private\joessh-candidate\JoeSSH.msix"
$JoeSshCandidateEvidence = "C:\private\joessh-candidate\candidate.json"
$JoeSshCaptureDirectory = "C:\private\joessh-store-captures-beta10"

node scripts/prepare-windows-store-assets.mjs init-session `
  --candidate $JoeSshCandidate `
  --candidate-evidence $JoeSshCandidateEvidence `
  --captures $JoeSshCaptureDirectory
```

Initialization records only the candidate file name, size, SHA-256, and the
candidate-evidence SHA-256. It creates the locale directories but no placeholder
PNGs. The script refuses to overwrite an existing capture directory.

Launch that exact candidate and capture the eight required states into the
paths listed above. Use only an isolated, non-production SSH fixture and
synthetic content. Before preparation, inspect every image at 100% zoom for
secrets, personal data, real infrastructure identifiers, cursor artifacts,
clipping, debug UI, and incorrect localization.

## Prepare And Verify

The final preparation command requires an explicit assertion that the eight
images were captured from the exact candidate used to initialize the session:

```powershell
$JoeSshAssetOutput = "C:\private\joessh-store-assets-beta10"

node scripts/prepare-windows-store-assets.mjs prepare `
  --candidate $JoeSshCandidate `
  --candidate-evidence $JoeSshCandidateEvidence `
  --captures $JoeSshCaptureDirectory `
  --output $JoeSshAssetOutput `
  --confirm-exact-candidate-captures
```

Preparation fails when any required image is absent, malformed, contains PNG
metadata or another non-image chunk, is not 1920 x 1080, is duplicated
byte-for-byte, or changes during copying. It also fails when the candidate or
`candidate.json` differs from the initialized capture session. The output
directory must not already exist.

The prepared private bundle contains:

- the eight final screenshots;
- generated 1:1 and 2:3 brand art;
- `candidate-binding.json` with candidate, preflight-evidence, session, and
  screenshot digests;
- `manifest.json` with dimensions, locale, scene, theme, size, and SHA-256 for
  every image;
- `SHA256SUMS.txt` covering every file except itself.

Verify the same bundle again immediately before manual upload review:

```powershell
node scripts/prepare-windows-store-assets.mjs verify `
  --bundle $JoeSshAssetOutput `
  --candidate $JoeSshCandidate `
  --candidate-evidence $JoeSshCandidateEvidence
```

Successful verification proves local file integrity and digest binding only.
The manifest remains `requires-final-human-review`; it never authorizes upload,
submission, or publication.

## Provisional Fail-Closed Check

The tracked reference bundle contains usable generated brand art but no final
screenshots and no candidate binding. Default verification must fail:

```powershell
node scripts/prepare-windows-store-assets.mjs verify `
  --bundle docs/assets/microsoft-store
```

Expected result: a non-zero exit with
`provisional-not-uploadable; final exact-candidate captures and candidate binding are required`.

To reproduce the provisional bundle in a new, empty comparison directory:

```powershell
node scripts/prepare-windows-store-assets.mjs provisional `
  --output C:\private\joessh-store-assets-provisional-check
```

Do not replace the final screenshots with the visual-regression references.
Those references are useful only for general layout composition.
