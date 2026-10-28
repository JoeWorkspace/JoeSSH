"use strict";
// Release regression against the actually installed reviewed backport.
// No require interception, network, or real signing credentials; all keys are synthetic.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const expectedVendor = path.join(root, "vendor/node-forge-1.4.2");
const expectedEntry = fs.realpathSync(
  path.join(expectedVendor, "lib/index.js"),
);
const forgeEntry = require.resolve("node-forge");
assert.equal(
  fs.realpathSync(forgeEntry),
  expectedEntry,
  "Installed node-forge must resolve to reviewed vendor",
);
const forge = require(forgeEntry);
const certsFile = require.resolve("@expo/code-signing-certificates");
const cliFile = path.join(
  root,
  "node_modules/@expo/cli/build/src/utils/codesigning.js",
);
const cliRequire = Module.createRequire(cliFile);
const cliCertsFile = cliRequire.resolve("@expo/code-signing-certificates");
for (const consumer of [certsFile, cliCertsFile, cliFile]) {
  assert.equal(
    fs.realpathSync(Module.createRequire(consumer).resolve("node-forge")),
    expectedEntry,
    "Every real Expo consumer must resolve the same reviewed vendor",
  );
}
const gitOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
const openssl =
  process.platform === "win32" && fs.existsSync(gitOpenSSL)
    ? gitOpenSSL
    : "openssl";
const binary = (b) => b.toString("latin1");
const bytes = (s) => Buffer.from(s, "latin1");
const message = Buffer.from(
  "JoeSSH isolated public synthetic crypto regression \u00f6\u4e2d\u6587\n",
);
const digest = (alg) => crypto.createHash(alg).update(message).digest();
const keys = [3, 65537].map((e) => {
  const pair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: e,
  });
  const privatePem = pair.privateKey.export({ format: "pem", type: "pkcs1" });
  const publicPem = pair.publicKey.export({ format: "pem", type: "spki" });
  return {
    ...pair,
    e,
    privatePem,
    publicPem,
    priv: forge.pki.privateKeyFromPem(privatePem),
    pub: forge.pki.publicKeyFromPem(publicPem),
  };
});
const key = keys[0];
function tlv(tag, data, longLength = false) {
  data = Buffer.from(data);
  assert(data.length < 128, "Fixture has short DER length");
  return Buffer.concat([
    Buffer.from(longLength ? [tag, 0x81, data.length] : [tag, data.length]),
    data,
  ]);
}
const oid = Buffer.from("608648016503040201", "hex");
function info({
  params = Buffer.from([5, 0]),
  extra = Buffer.alloc(0),
  outerExtra = Buffer.alloc(0),
  outerLong = false,
  innerLong = false,
  oidLong = false,
  digestLong = false,
  nullLong = false,
  hash = digest("sha256"),
} = {}) {
  const p = nullLong ? Buffer.from([5, 0x81, 0]) : params;
  const inner = tlv(
    0x30,
    Buffer.concat([tlv(6, oid, oidLong), p, extra]),
    innerLong,
  );
  return tlv(
    0x30,
    Buffer.concat([inner, tlv(4, hash, digestLong), outerExtra]),
    outerLong,
  );
}
function rawSignature(
  k,
  digestInfo,
  { paddingByte = 0xff, shortPadding = false } = {},
) {
  const n = 256;
  const paddingLength = shortPadding ? 7 : n - digestInfo.length - 3;
  const encoded = Buffer.concat([
    Buffer.from([0, 1]),
    Buffer.alloc(paddingLength, paddingByte),
    Buffer.from([0]),
    digestInfo,
  ]);
  const final =
    encoded.length === n
      ? encoded
      : Buffer.concat([encoded, Buffer.alloc(n - encoded.length)]);
  return crypto.privateEncrypt(
    { key: k.privateKey, padding: crypto.constants.RSA_NO_PADDING },
    final,
  );
}
function verify(k, hash, signature, options) {
  try {
    return (
      k.pub.verify(binary(hash), binary(signature), undefined, options) === true
    );
  } catch {
    return false;
  }
}
const malformed = [
  ["nested extra element", { extra: tlv(2, Buffer.alloc(12, 0x88)) }],
  [
    "non-NULL second algorithm element",
    { params: tlv(2, Buffer.alloc(12, 0x88)) },
  ],
  ["NULL carries data", { params: tlv(5, Buffer.alloc(12, 0x88)) }],
  ["outer non-minimal length", { outerLong: true }],
  ["inner non-minimal length", { innerLong: true }],
  ["OID non-minimal length", { oidLong: true }],
  ["NULL non-minimal length", { nullLong: true }],
  ["digest non-minimal length", { digestLong: true }],
  ["extra outer element", { outerExtra: tlv(2, Buffer.from([1])) }],
];
for (const [label, shape] of malformed) {
  test("security rejects " + label, () => {
    for (const k of keys) {
      const signature = rawSignature(k, info(shape));
      assert.equal(
        verify(k, digest("sha256"), signature),
        false,
        "Malformed DigestInfo accepted",
      );
      assert.equal(
        crypto.verify("sha256", message, k.publicKey, signature),
        false,
        "Node/OpenSSL agrees on rejection",
      );
    }
  });
}
test("security rejects trailing bytes in default mode", () => {
  assert.equal(
    verify(
      key,
      digest("sha256"),
      rawSignature(key, Buffer.concat([info(), Buffer.from([0])])),
    ),
    false,
  );
});
test("security rejects wrong digest, invalid type-1 padding, and short padding", () => {
  assert.equal(
    verify(key, Buffer.alloc(32, 1), rawSignature(key, info())),
    false,
  );
  assert.equal(
    verify(
      key,
      digest("sha256"),
      rawSignature(key, info(), { paddingByte: 0xfe }),
    ),
    false,
  );
  assert.equal(
    verify(
      key,
      digest("sha256"),
      rawSignature(key, info(), { shortPadding: true }),
    ),
    false,
  );
});
test("compatibility retains explicitly unsupported trailing-data testing flag", () => {
  assert.equal(
    verify(
      key,
      digest("sha256"),
      rawSignature(key, Buffer.concat([info(), Buffer.from([0])])),
      { _parseAllDigestBytes: false },
    ),
    true,
  );
});
for (const k of keys) {
  for (const alg of ["sha256", "sha384", "sha512"]) {
    test("Node crypto PKCS1 v1.5 bidirectional " + alg + " e=" + k.e, () => {
      const sig = crypto.sign(alg, message, k.privateKey);
      assert.equal(verify(k, digest(alg), sig), true);
      const md = forge.md[alg].create().update(binary(message));
      const forgeSig = bytes(k.priv.sign(md));
      assert.equal(crypto.verify(alg, message, k.publicKey, forgeSig), true);
      assert.equal(
        crypto.verify(alg, Buffer.from("altered"), k.publicKey, forgeSig),
        false,
      );
    });
  }
  test("canonical SHA256 with and without NULL e=" + k.e, () => {
    for (const params of [Buffer.from([5, 0]), Buffer.alloc(0)]) {
      assert.equal(
        verify(k, digest("sha256"), rawSignature(k, info({ params }))),
        true,
      );
    }
  });
  test("PSS SHA256 bidirectional e=" + k.e, () => {
    const scheme = () =>
      forge.pss.create({
        md: forge.md.sha256.create(),
        mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
        saltLength: 32,
      });
    const sig = crypto.sign("sha256", message, {
      key: k.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    });
    assert.equal(
      k.pub.verify(binary(digest("sha256")), binary(sig), scheme()),
      true,
    );
    const md = forge.md.sha256.create().update(binary(message));
    const signed = bytes(k.priv.sign(md, scheme()));
    assert.equal(
      crypto.verify(
        "sha256",
        message,
        {
          key: k.publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        signed,
      ),
      true,
    );
  });
  test("NONE raw digest signatures retain behavior e=" + k.e, () => {
    const raw = binary(digest("sha256"));
    const sig = k.priv.sign(raw, "NONE");
    assert.equal(k.pub.verify(raw, sig, "NONE"), true);
    assert.equal(k.pub.verify(binary(Buffer.alloc(32)), sig, "NONE"), false);
    const recovered = crypto.publicDecrypt(
      { key: k.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      bytes(sig),
    );
    assert(recovered.equals(digest("sha256")));
  });
}
test("OpenSSL CLI PKCS1 v1.5 bidirectional SHA256/384/512, e=3/65537", () => {
  const version = spawnSync(openssl, ["version"], {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  assert(
    !version.error && version.status === 0 && /^OpenSSL\s/.test(version.stdout),
    "OpenSSL CLI is required; version probe failure must fail",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "joessh-forge-interop-"));
  const run = (args) => {
    const r = spawnSync(openssl, args, {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    assert(
      !r.error && r.status === 0,
      "OpenSSL command failed; no credential diagnostics emitted",
    );
    return r;
  };
  try {
    const input = path.join(dir, "message.bin");
    fs.writeFileSync(input, message);
    for (const k of keys) {
      const keyFile = path.join(dir, "synthetic-key.pem"),
        pubFile = path.join(dir, "synthetic-public.pem"),
        sigFile = path.join(dir, "signature.bin");
      fs.writeFileSync(keyFile, k.privatePem, { mode: 0o600 });
      fs.writeFileSync(pubFile, k.publicPem);
      for (const alg of ["sha256", "sha384", "sha512"]) {
        run(["dgst", "-" + alg, "-sign", keyFile, "-out", sigFile, input]);
        assert.equal(verify(k, digest(alg), fs.readFileSync(sigFile)), true);
        const md = forge.md[alg].create().update(binary(message));
        fs.writeFileSync(sigFile, bytes(k.priv.sign(md)));
        run([
          "dgst",
          "-" + alg,
          "-verify",
          pubFile,
          "-signature",
          sigFile,
          input,
        ]);
      }
    }
  } finally {
    // Only the exact private temporary directory created above is removed.
    assert(
      path.dirname(dir) === os.tmpdir() &&
        path.basename(dir).startsWith("joessh-forge-interop-"),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("actual installed Expo certificate/CSR/manifest consumer interoperability", async () => {
  const certs = require(certsFile);
  const cli = require(cliFile);
  for (const k of keys) {
    const pair = certs.convertKeyPairPEMToKeyPair({
      privateKeyPEM: k.privatePem,
      publicKeyPEM: k.publicPem,
    });
    const cert = certs.generateSelfSignedCodeSigningCertificate({
      keyPair: pair,
      validityNotBefore: new Date(Date.now() - 60000),
      validityNotAfter: new Date(Date.now() + 86400000),
      commonName: "JoeSSH isolated fixture",
    });
    certs.validateSelfSignedCertificate(cert, pair);
    const certPem = certs.convertCertificateToCertificatePEM(cert);
    const decoded = certs.convertCertificatePEMToCertificate(certPem);
    certs.validateSelfSignedCertificate(decoded, pair);
    assert(
      new crypto.X509Certificate(certPem).verify(k.publicKey),
      "Node verifies generated certificate",
    );
    const signed = certs.signBufferRSASHA256AndVerify(
      pair.privateKey,
      decoded,
      message,
    );
    assert.equal(
      crypto.verify(
        "sha256",
        message,
        k.publicKey,
        Buffer.from(signed, "base64"),
      ),
      true,
    );
    const csr = certs.generateCSR(pair, "JoeSSH isolated CSR");
    const roundtrip = certs.convertCSRPEMToCSR(certs.convertCSRToCSRPEM(csr));
    const leaf = certs.generateDevelopmentCertificateFromCSR(
      pair.privateKey,
      decoded,
      roundtrip,
      "synthetic-app",
      "synthetic-scope",
    );
    assert.equal(decoded.verify(leaf), true);
    assert(
      new crypto.X509Certificate(
        certs.convertCertificateToCertificatePEM(leaf),
      ).verify(k.publicKey),
    );
    const manifest = '{"id":"isolated-fixture","name":"JoeSSH"}';
    const cliSig = cli.signManifestString(manifest, {
      privateKey: k.privatePem,
      certificateForPrivateKey: certPem,
    });
    assert.equal(
      crypto.verify(
        "sha256",
        Buffer.from(manifest),
        k.publicKey,
        Buffer.from(cliSig, "base64"),
      ),
      true,
    );
    // Exercise actual CLI getCodeSigningInfoAsync using temporary synthetic inputs,
    // without EAS network, cache, user certificates, or real signing credentials.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "joessh-forge-expo-"));
    try {
      const certFile = path.join(dir, "synthetic-cert.pem"),
        privFile = path.join(dir, "synthetic-key.pem");
      fs.writeFileSync(certFile, certPem);
      fs.writeFileSync(privFile, k.privatePem, { mode: 0o600 });
      const actual = await cli.getCodeSigningInfoAsync(
        {
          updates: {
            codeSigningCertificate: certFile,
            codeSigningMetadata: {
              alg: "rsa-v1_5-sha256",
              keyid: "isolated-test",
            },
          },
        },
        'keyid="isolated-test", alg="rsa-v1_5-sha256"',
        privFile,
      );
      assert.equal(actual.keyId, "isolated-test");
      const out = cli.signManifestString(manifest, actual);
      assert(
        crypto.verify(
          "sha256",
          Buffer.from(manifest),
          k.publicKey,
          Buffer.from(out, "base64"),
        ),
      );
      await assert.rejects(
        () =>
          cli.getCodeSigningInfoAsync(
            {
              updates: {
                codeSigningCertificate: certFile,
                codeSigningMetadata: {
                  alg: "rsa-v1_5-sha256",
                  keyid: "isolated-test",
                },
              },
            },
            'keyid="wrong", alg="rsa-v1_5-sha256"',
            privFile,
          ),
        /keyid mismatch/,
      );
    } finally {
      assert(
        path.dirname(dir) === os.tmpdir() &&
          path.basename(dir).startsWith("joessh-forge-expo-"),
      );
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
for (const kind of ["certificate", "CSR"]) {
  test("actual Expo rejects malformed " + kind + " signature", () => {
    const certs = require(certsFile);
    for (const k of keys) {
      const pair = { privateKey: k.priv, publicKey: k.pub };
      const cert = certs.generateSelfSignedCodeSigningCertificate({
        keyPair: pair,
        validityNotBefore: new Date(Date.now() - 60000),
        validityNotAfter: new Date(Date.now() + 86400000),
        commonName: "Synthetic rejection fixture",
      });
      const certPem = certs.convertCertificateToCertificatePEM(cert);
      if (kind === "certificate") {
        const corrupted = certs.convertCertificatePEMToCertificate(certPem);
        const hash = bytes(corrupted.md.digest().getBytes());
        corrupted.signature = binary(
          rawSignature(
            k,
            info({ hash, params: tlv(5, Buffer.alloc(12, 0x88)) }),
          ),
        );
        assert.throws(
          () => certs.validateSelfSignedCertificate(corrupted, pair),
          undefined,
          "Expo must reject malformed certificate signature",
        );
      } else {
        const csr = certs.generateCSR(pair, "Synthetic CSR rejection fixture");
        const corrupted = certs.convertCSRPEMToCSR(
          certs.convertCSRToCSRPEM(csr),
        );
        const hash = bytes(corrupted.md.digest().getBytes());
        corrupted.signature = binary(
          rawSignature(
            k,
            info({ hash, params: tlv(5, Buffer.alloc(12, 0x88)) }),
          ),
        );
        assert.throws(
          () =>
            certs.generateDevelopmentCertificateFromCSR(
              pair.privateKey,
              cert,
              corrupted,
              "synthetic-app",
              "synthetic-scope",
            ),
          undefined,
          "Expo must reject malformed CSR signature",
        );
      }
    }
  });
}
test("Node-only distributable excludes every old browser bundle", () => {
  const dir = expectedVendor;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "node-forge");
  assert.equal(pkg.version, "1.4.2");
  assert(!fs.existsSync(path.join(dir, "dist")));
  assert(!fs.existsSync(path.join(dir, "flash")));
  assert.deepEqual(pkg.exports["."], { node: "./lib/index.js" });
  assert.equal(pkg.exports["./dist/*"], undefined);
  assert.equal(pkg.scripts, undefined);
  const selfRequire = Module.createRequire(path.join(dir, "package.json"));
  assert.equal(selfRequire("node-forge"), forge);
  assert.throws(() => selfRequire("node-forge/dist/forge.min.js"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
  assert.throws(() => selfRequire("node-forge/dist/forge.all.min.js"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});

// These fixtures are synthetic and exercise upstream 1.4.1/1.4.2 hardening.
test("PEM string and Buffer inputs decode equivalently", () => {
  const stringParts = forge.pem.decode(key.privatePem);
  const bufferParts = forge.pem.decode(Buffer.from(key.privatePem));
  assert.deepEqual(bufferParts, stringParts);
});
test("PKCS#12 iteration bounds preserve valid key derivation and MAC", () => {
  for (const count of [0, -1]) {
    assert.throws(() => forge.pbe.generatePkcs12Key("synthetic", forge.util.createBuffer("salt"), 1, count, 16), /iteration count/);
  }
  for (const count of [1, 2048]) {
    assert.equal(forge.pbe.generatePkcs12Key("synthetic", forge.util.createBuffer("salt"), 1, count, 16).length(), 16);
    const pfx = forge.pkcs12.toPkcs12Asn1(null, null, "synthetic", { count });
    assert.doesNotThrow(() => forge.pkcs12.pkcs12FromAsn1(pfx, "synthetic"));
    if (count === 1) {
      pfx.value[2].value.pop(); // ASN.1 DEFAULT 1
      assert.doesNotThrow(() => forge.pkcs12.pkcs12FromAsn1(pfx, "synthetic"));
    }
  }
  for (const bytes of ["\x00", "\xff"]) {
    const pfx = forge.pkcs12.toPkcs12Asn1(null, null, "synthetic", { count: 1 });
    pfx.value[2].value[2].value = bytes;
    assert.throws(() => forge.pkcs12.pkcs12FromAsn1(pfx, "synthetic"), bytes === "\x00" ? /iteration count/ : /MAC could not be verified/);
  }
});
test("AES-GCM rejects zero authentication tags and supports a valid tag", () => {
  const secret = "\x00".repeat(16);
  const iv = "\x00".repeat(12);
  const encrypt = forge.cipher.createCipher("AES-GCM", secret);
  assert.throws(() => encrypt.start({ iv, tagLength: 0 }), /tag length/i);
  encrypt.start({ iv, tagLength: 128 });
  encrypt.update(forge.util.createBuffer("synthetic"));
  assert.equal(encrypt.finish(), true);
  const decrypt = forge.cipher.createDecipher("AES-GCM", secret);
  decrypt.start({ iv, tagLength: 128, tag: encrypt.mode.tag });
  decrypt.update(forge.util.createBuffer(encrypt.output.bytes()));
  assert.equal(decrypt.finish(), true);
  assert.equal(decrypt.output.bytes(), "synthetic");
});
