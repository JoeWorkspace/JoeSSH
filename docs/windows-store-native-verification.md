# Windows Store Native Verification Bundle

The Microsoft WACK installers, SDK component media, WebView2 installer, baseline
MSIX, and generated jobs are release evidence stored outside the source
repository. They must never be inferred from a previous run or committed as
repository dependencies. The small tracked
[`windows-store-native-verification-bundle.json`](windows-store-native-verification-bundle.json)
binds the exact reviewed harness files and seven-component offline toolchain
manifest required for the beta.25 qualification run.

Before preparing a job, copy the reviewed harness and toolchain into a new
operator-controlled evidence directory. Recompute every file SHA256 and require
an exact match with the tracked manifest. The toolchain manifest must have SHA256
`b9834cf7a50d5c310158cb315783abba8c5141eeed09a1129ea83a8df66337d9`,
37 files including the manifest, 149,501,708 total bytes, and seven components.
One component must be Windows SDK for Windows Store Apps Contracts with product
code `{E8BE09DF-D93B-AE40-FD63-05E5ABEFB6D9}`. A six-component snapshot or the
similarly named Store Apps Metadata product is not a substitute.

Run the manifest's `selfTest.command` with Windows PowerShell 5.1 and require
36/36 passing checks before each real job. The reviewed writer emits BOM-less
UTF-8 JSON constrained to the ASCII subset with JSON Unicode escapes, and the
shared reader strictly decodes UTF-8 while rejecting a BOM or invalid bytes. The
36th self-test covers Windows PowerShell 5.1 default parsing, the shared strict
reader, BOM and invalid-UTF-8 rejection, and top-level array cardinality. Before
the bundle is used, a separate compatibility review must parse every JSON file
from the fresh self-test directory with Windows PowerShell 5.1, PowerShell 7,
and Python and record those runtime versions and results. Then invoke
`Prepare-NativeVerification.ps1` with all of these explicit inputs:

- the exact source-built beta.25 MSIX path, independently anchored SHA256, exact
  merged 40-character source commit, and `-ExpectedVersion 1.1.25.0`;
- the immutable published `1.1.22.0` baseline path and its independently anchored
  SHA256;
- only the baseline's uniquely matching Windows App Runtime dependency and the
  reviewed offline WebView2 installer;
- the reviewed seven-component `-Toolchain`, a new output directory, and the
  explicit disposable-Sandbox signing/UI-review switches required by the run.

The preparation script must reject a dirty identity, wrong package version,
wrong hash, stale output directory, unsigned input without the explicit
guest-only test-signing switch, missing dependency, or mismatched toolchain. It
creates a new WSB job but does not launch it. Start that exact generated WSB only
after recording its input manifest and script/toolchain hashes.

After the guest finishes and cleans up, run `Verify-NativeEvidence.ps1` against
the new job with the same candidate SHA256, baseline SHA256, and source commit.
The verifier independently rehashes the original WACK XML and every evidence
file, reparses every WACK requirement/test result, and compares the complete
summary with `result.json`. Missing, duplicate, partial, unknown, warning, or
nonpassing results remain visible and fail closed. Never edit an old job into a
new schema or rewrite an optional failure as PASS.

The native evidence archive must include the tracked bundle manifest, the exact
candidate/source anchors, `toolchain.json`, guest/host result files, original
WACK XML, complete evidence checksum inventory, and separate UI observations.
All required WACK tests must pass. An optional WACK finding may be considered
only in a separate signed review record that cites Microsoft's optional-test
classification and the code-level cause; it does not change the original XML or
host-verifier result. Partner Center validation and certification remain
separate gates.
