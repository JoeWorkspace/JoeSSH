console.error(
  [
    "Windows invite Stage B is No-Go.",
    "A signed candidate cannot be packaged until all of the following exist:",
    "- a trusted Windows code-signing certificate and timestamp service;",
    "- a fixed, independently verified SignTool path;",
    "- Defender scan evidence bound to the installer SHA-256;",
    "- a clean-VM native-smoke promotion command with zero open P0/P1 issues.",
    "Use Stage A only for 3-5 trusted technical testers in isolated environments.",
  ].join("\n"),
);
process.exit(1);
