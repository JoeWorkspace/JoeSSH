// Reviewed associations for these exact immutable crate archives only.
// Preserve content-association limits; these are not assertions of a publish commit.
export const reviewedCargoLicenseSources = [
  {
    "component": "cargo:libappindicator-sys@0.9.0",
    "archiveSha256": "6e9ec52138abedcc58dc17a7c6c0c00a2bdb4f3427c7f63fa97fd0d859155caf",
    "repository": "https://github.com/tauri-apps/libappindicator-rs",
    "commit": "eafd1e3682a1247f595410266091e9684021cb6f",
    "pathInVcs": "sys",
    "associationKind": "archive-vcs-sha-with-reviewed-repository",
    "limitation": "Archive repository metadata absent. Official repo binding is independently established from archive CHANGELOG GitHub links and byte-identical sys/Cargo.toml, sys/CHANGELOG.md, sys/src/lib.rs at the archive-recorded SHA.",
    "materials": [
      {
        "path": "LICENSE-MIT",
        "sha256": "eb227437252b2a7a9c1fc342c93ade1f3d7ce38cc6dd754f613db07d53ceff0b",
        "gitBlobSha1": "50e79e21ccd1454f00695108ae01eaff9569689a"
      },
      {
        "path": "LICENSE-APACHE",
        "sha256": "a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2",
        "gitBlobSha1": "16fe87b06e802f094b3fbb0894b137bca2b16ef1"
      }
    ]
  },
  {
    "component": "cargo:tao-macros@0.1.3",
    "archiveSha256": "f4e16beb8b2ac17db28eab8bca40e62dbfbb34c0fcdc6d9826b11b7b5d047dfd",
    "repository": "https://github.com/tauri-apps/tao",
    "commit": "340684d932b6126bed449fc1f4edca81776ad592",
    "pathInVcs": "tao-macros",
    "associationKind": "official-release-tag-with-full-original-source-content-match",
    "limitation": "Archive .cargo_vcs_info absent. Official release tag association plus six byte-identical original source files; Cargo-generated normalized Cargo.toml and Cargo.lock excluded. README.md maps to repository root.",
    "materials": [
      {
        "path": "LICENSE",
        "sha256": "6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a",
        "gitBlobSha1": "ad410e11302107da9aa47ce3d46bd5ad011c4c43"
      },
      {
        "path": "LICENSE.spdx",
        "sha256": "02b6448337b757772d90e5f31caaa0f9e6afaad2221c01771d0a3deaa4d4196c",
        "gitBlobSha1": "ac886c6d67b90bfe916afc35c56f45b8bd196775"
      }
    ]
  },
  {
    "component": "cargo:winapi-i686-pc-windows-gnu@0.4.0",
    "archiveSha256": "ac3b87c63620426dd9b991e5ce0329eff545bccbbb34f3be09ff6fb6ab51b7b6",
    "repository": "https://github.com/retep998/winapi-rs",
    "commit": "30ed8e3b86f4a8a55e68865843c19800f57bcd7f",
    "pathInVcs": "i686",
    "associationKind": "reviewed-source-commit-not-recorded-publish-sha",
    "limitation": "No archive .cargo_vcs_info. This is the latest official repository commit preceding the published version time. Every source/build/library file matches (1389 or 1418 files); Cargo.toml.orig differs only in version 0.3.2 -> 0.4.0. It is a reviewed source-content association, not a recorded publishing commit. Preserve this distinction in metadata.",
    "materials": [
      {
        "path": "LICENSE-MIT",
        "sha256": "5b19674a1db628a475850a131956ed49521b744e3dda8f5a94141f9aba681219",
        "gitBlobSha1": "796e929aa550bcf4840b199500b7c5bf96edcb75"
      },
      {
        "path": "LICENSE-APACHE",
        "sha256": "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1",
        "gitBlobSha1": "8dada3edaf50dbc082c9a125058f25def75e625a"
      }
    ]
  },
  {
    "component": "cargo:winapi-x86_64-pc-windows-gnu@0.4.0",
    "archiveSha256": "712e227841d057c1ee1cd2fb22fa7e5a5461ae8e48fa2ca79ec42cfc1931183f",
    "repository": "https://github.com/retep998/winapi-rs",
    "commit": "30ed8e3b86f4a8a55e68865843c19800f57bcd7f",
    "pathInVcs": "x86_64",
    "associationKind": "reviewed-source-commit-not-recorded-publish-sha",
    "limitation": "No archive .cargo_vcs_info. This is the latest official repository commit preceding the published version time. Every source/build/library file matches (1389 or 1418 files); Cargo.toml.orig differs only in version 0.3.2 -> 0.4.0. It is a reviewed source-content association, not a recorded publishing commit. Preserve this distinction in metadata.",
    "materials": [
      {
        "path": "LICENSE-MIT",
        "sha256": "5b19674a1db628a475850a131956ed49521b744e3dda8f5a94141f9aba681219",
        "gitBlobSha1": "796e929aa550bcf4840b199500b7c5bf96edcb75"
      },
      {
        "path": "LICENSE-APACHE",
        "sha256": "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1",
        "gitBlobSha1": "8dada3edaf50dbc082c9a125058f25def75e625a"
      }
    ]
  }
];

// These exact archives contain an original MPL notice explicitly referring to Mozilla.
export const referencedCargoLicenseSources = [
  {
    "component": "cargo:selectors@0.36.1",
    "archiveSha256": "c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c",
    "noticeFile": "lib.rs",
    "noticeSha256": "766674381e88a468d55e07de3596987391cf0e8beebe51baf4fddf11078785b3",
    "noticeFileSha256": "d54c6e13e9e952dac17d209171df8657e3cae93beaddace4906150cdec8d02e9",
    "licenseTextFile": "mozilla-MPL-2.0.txt",
    "licenseTextSha256": "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04",
    "licenseTextUrl": "https://www.mozilla.org/media/MPL/2.0/index.txt"
  },
  {
    "component": "cargo:selectors@0.38.0",
    "archiveSha256": "8adfa1c298912827b8a28b223b3b874357397ae706e6190acd9bf28cee99114d",
    "noticeFile": "lib.rs",
    "noticeSha256": "766674381e88a468d55e07de3596987391cf0e8beebe51baf4fddf11078785b3",
    "noticeFileSha256": "d54c6e13e9e952dac17d209171df8657e3cae93beaddace4906150cdec8d02e9",
    "licenseTextFile": "mozilla-MPL-2.0.txt",
    "licenseTextSha256": "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04",
    "licenseTextUrl": "https://www.mozilla.org/media/MPL/2.0/index.txt"
  }
];
