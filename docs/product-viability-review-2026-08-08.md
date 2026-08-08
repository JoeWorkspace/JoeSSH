# JoeSSH product viability review

Decision date: 2026-08-08
Decision: freeze new feature development after the accessibility and security
closeout; continue maintenance only unless external demand is demonstrated.

## Conclusion

JoeSSH has enough engineering depth to remain a useful open-source project, but
the available evidence does not justify more speculative feature development.
The current release already spans a Desktop SSH workbench, SFTP, forwarding,
host-key controls, a Web Admin viewer, self-hosted Sync, and a mobile companion
preview. Expanding all of those surfaces would increase security, support, and
accessibility costs before product-market fit has been shown.

The repository had zero stars, zero forks, zero subscribers, no published
GitHub release assets, and no external adoption signal visible through the
GitHub API at the time of this review. Those numbers are not a verdict on code
quality; they mean there is not yet evidence that another feature is the highest
value use of development time.

## Competitive position

The category is mature and crowded:

- [Termius](https://termius.com/pricing) already sells desktop/mobile sync and
  collaboration plans.
- [Tabby](https://github.com/Eugeny/tabby) provides a mature cross-platform,
  extensible SSH terminal and self-hostable web option.
- [SecureCRT](https://www.vandyke.com/products/securecrt/) competes on mature
  session management, scripting, support, and accessibility conformance
  documentation.
- [MobaXterm](https://getmobaxterm.com/) bundles SSH, SFTP, X11, RDP, and a broad
  Windows network toolbox.

JoeSSH's defensible angle is narrower: local-first operation, strict host-key
handling, optional self-hosted sync, transparent open-source security controls,
and accessibility as a release gate. It should not try to win by matching every
competitor feature.

## Closeout scope

The final feature-bearing release should be limited to:

1. the verified Sync cursor and audit-ID correctness fixes, plus Mobile Sync
   request timeout and redacted malformed-JSON error handling identified during
   release review;
2. automated checks targeting WCAG 2.2 Level AA, focus-not-obscured and
   target-size safeguards, and an EAA-oriented accessibility assessment status;
3. safe dependency and advisory remediation that passes the full release gate;
4. branch consolidation through protected GitHub pull requests; and
5. documentation that labels preview or operator-dependent capabilities
   honestly.

After that release, accept security fixes, compatibility fixes, accessibility
barriers, and well-scoped community contributions. Do not build new protocols,
hosted SaaS, billing, mutating team administration, or a full mobile SSH client
without new evidence.

## Conditions for resuming feature development

Reopen feature investment only when at least one of these signals exists:

- 20 independently acquired monthly active users retained for two consecutive
  months;
- five external users who repeatedly complete the same unmet workflow and agree
  to validate a proposed fix;
- three organizations requesting the same deployment or administration feature
  with a credible support or funding commitment; or
- a community contributor willing to own implementation and maintenance of a
  bounded feature.

Until then, maintenance is the product strategy, not a temporary pause.
