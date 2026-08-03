import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkPublicPage,
  checkStorePublicPages,
  createPinnedLookup,
  parseArgs,
  parsePublicHttpsUrl,
} from "./check-store-public-pages.mjs";

const CHECKER_PATH = fileURLToPath(
  new URL("./check-store-public-pages.mjs", import.meta.url),
);
const PRIVACY_TEMPLATE_PATH = fileURLToPath(
  new URL(
    "../docs/store-public-pages/privacy-policy.template.html",
    import.meta.url,
  ),
);
const SUPPORT_TEMPLATE_PATH = fileURLToPath(
  new URL("../docs/store-public-pages/support.template.html", import.meta.url),
);
const PUBLIC_DNS = async () => [{ address: "93.184.216.34", family: 4 }];

function pageHtml(role, replacement = "") {
  const content =
    role === "privacy"
      ? `
        <p>JoeSSH is a local-first application. Connection details remain on this device by default.</p>
        <p>Optional telemetry is disabled unless the user opts in. Contact the publisher about privacy.</p>`
      : `
        <p>JoeSSH Community support is provided on a best-effort basis.</p>
        <p>Open an issue for a reproducible problem. Send security reports through the private route.</p>
        <p>Contact the publisher using the public support route.</p>`;
  return `<!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"><title>JoeSSH Community ${role}</title></head>
      <body>
        <main>
          <h1>JoeSSH Community ${role}</h1>
          <p>Last updated: 2026-08-01</p>
          <p>Publisher: Joe Developer</p>
          ${content}
          <p><a data-joessh-contact="${role}" href="https://github.com/JoeWorkspace/JoeSSH/issues">Contact JoeSSH</a></p>
          ${replacement}
        </main>
      </body>
    </html>`;
}

function htmlResponse(role, options = {}) {
  const body = options.body ?? pageHtml(role);
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(body, {
    headers,
    status: options.status ?? 200,
  });
}

function routeFetch(routes, calls = []) {
  return async (input, init) => {
    const url = new URL(input);
    calls.push({ init, url: url.href });
    const route = routes.get(url.pathname);
    if (!route) {
      throw new Error(`Unexpected URL: ${url.href}`);
    }
    return typeof route === "function" ? route(url, init) : route;
  };
}

test("passes distinct public privacy and support pages without credentials", async () => {
  const calls = [];
  const report = await checkStorePublicPages(
    {
      privacyUrl: "https://joessh.dev/privacy/",
      publisherDisplayName: "Joe Developer",
      supportUrl: "https://joessh.dev/support/",
    },
    {
      fetchFn: routeFetch(
        new Map([
          ["/privacy/", htmlResponse("privacy")],
          ["/support/", htmlResponse("support")],
        ]),
        calls,
      ),
      lookupFn: PUBLIC_DNS,
    },
  );

  assert.equal(report.decision, "pass");
  assert.deepEqual(
    report.pages.map((page) => [page.role, page.ok, page.status]),
    [
      ["privacy", true, 200],
      ["support", true, 200],
    ],
  );
  assert.equal(calls.length, 2);
  for (const { init } of calls) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.equal(init.headers.Cookie, undefined);
    assert.equal(init.headers.Authorization, undefined);
  }
});

test("binds both public pages to the private exact publisher identity", async () => {
  const privateName = "Private Publisher Sentinel";
  const report = await checkStorePublicPages(
    {
      privacyUrl: "https://joessh.dev/privacy/",
      publisherDisplayName: privateName,
      supportUrl: "https://joessh.dev/support/",
    },
    {
      fetchFn: async () => htmlResponse("privacy"),
      lookupFn: PUBLIC_DNS,
    },
  );

  assert.equal(report.decision, "fail");
  assert.ok(
    report.pages.every((page) =>
      /exact verified publisher display name/.test(page.error),
    ),
  );
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateName));
});

test("committed static templates pass only after every manual field is supplied", async () => {
  const privacyTemplate = readFileSync(PRIVACY_TEMPLATE_PATH, "utf8");
  const supportTemplate = readFileSync(SUPPORT_TEMPLATE_PATH, "utf8");
  const replacements = new Map([
    ["{{POLICY_EFFECTIVE_DATE_ISO}}", "2026-08-01"],
    ["{{PARTNER_CENTER_PUBLISHER_DISPLAY_NAME}}", "Joe Developer"],
    ["{{PUBLIC_PRIVACY_CONTACT_HREF}}", "https://joessh.dev/privacy/contact/"],
    ["{{PUBLIC_PRIVACY_CONTACT_LABEL}}", "Privacy contact form"],
    [
      "{{PUBLIC_SUPPORT_CONTACT_HREF}}",
      "https://github.com/JoeWorkspace/JoeSSH/issues/new/choose",
    ],
    ["{{PUBLIC_SUPPORT_CONTACT_LABEL}}", "JoeSSH issue forms"],
    ["{{PUBLIC_PRIVACY_URL}}", "https://joessh.dev/privacy/"],
  ]);
  const render = (template) => {
    let rendered = template;
    for (const [field, value] of replacements) {
      rendered = rendered.replaceAll(field, value);
    }
    return rendered;
  };

  const blockedReport = await checkStorePublicPages(
    {
      privacyUrl: "https://joessh.dev/privacy/",
      publisherDisplayName: "Joe Developer",
      supportUrl: "https://joessh.dev/support/",
    },
    {
      fetchFn: routeFetch(
        new Map([
          [
            "/privacy/",
            new Response(privacyTemplate, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
          ],
          [
            "/support/",
            new Response(supportTemplate, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
          ],
        ]),
      ),
      lookupFn: PUBLIC_DNS,
    },
  );
  assert.equal(blockedReport.decision, "fail");
  assert.ok(
    blockedReport.pages.every((page) => /placeholder/.test(page.error)),
  );

  const renderedReport = await checkStorePublicPages(
    {
      privacyUrl: "https://joessh.dev/privacy/",
      publisherDisplayName: "Joe Developer",
      supportUrl: "https://joessh.dev/support/",
    },
    {
      fetchFn: routeFetch(
        new Map([
          [
            "/privacy/",
            new Response(render(privacyTemplate), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
          ],
          [
            "/support/",
            new Response(render(supportTemplate), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
          ],
        ]),
      ),
      lookupFn: PUBLIC_DNS,
    },
  );
  assert.equal(renderedReport.decision, "pass");
});

test("allows only bounded same-origin canonical redirects", async () => {
  const result = await checkPublicPage(
    "privacy",
    "https://joessh.dev/privacy",
    {
      fetchFn: routeFetch(
        new Map([
          [
            "/privacy",
            new Response(null, {
              headers: { Location: "/privacy/" },
              status: 301,
            }),
          ],
          ["/privacy/", htmlResponse("privacy")],
        ]),
      ),
      lookupFn: PUBLIC_DNS,
    },
  );

  assert.equal(result.finalUrl, "https://joessh.dev/privacy/");
  assert.deepEqual(result.redirects, ["https://joessh.dev/privacy/"]);
});

test("rejects authentication, cross-origin, loop, and excessive redirects", async (t) => {
  const cases = [
    {
      expected: /authentication route/,
      routes: new Map([
        [
          "/privacy",
          new Response(null, {
            headers: { Location: "/login?next=/privacy" },
            status: 302,
          }),
        ],
      ]),
    },
    {
      expected: /across origins/,
      routes: new Map([
        [
          "/privacy",
          new Response(null, {
            headers: { Location: "https://pages.joessh.dev/privacy" },
            status: 302,
          }),
        ],
      ]),
    },
    {
      expected: /redirect loop/,
      routes: new Map([
        [
          "/privacy",
          new Response(null, {
            headers: { Location: "/privacy/next" },
            status: 302,
          }),
        ],
        [
          "/privacy/next",
          new Response(null, {
            headers: { Location: "/privacy" },
            status: 302,
          }),
        ],
      ]),
    },
    {
      expected: /exceeded 1 redirects/,
      maxRedirects: 1,
      routes: new Map([
        [
          "/privacy",
          new Response(null, {
            headers: { Location: "/privacy/one" },
            status: 302,
          }),
        ],
        [
          "/privacy/one",
          new Response(null, {
            headers: { Location: "/privacy/two" },
            status: 302,
          }),
        ],
      ]),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.expected.source, async () => {
      await assert.rejects(
        checkPublicPage("privacy", "https://joessh.dev/privacy", {
          fetchFn: routeFetch(fixture.routes),
          lookupFn: PUBLIC_DNS,
          maxRedirects: fixture.maxRedirects,
        }),
        fixture.expected,
      );
    });
  }
});

test("rejects non-public input URLs before fetching", async () => {
  const invalidUrls = [
    "http://joessh.dev/privacy",
    "https://localhost/privacy",
    "https://127.0.0.1/privacy",
    "https://10.0.0.5/privacy",
    "https://example.com/privacy",
    "https://user:secret@joessh.dev/privacy",
    "https://joessh.dev/privacy?preview_token=secret",
    "https://joessh.dev/privacy#draft",
    "https://{{REAL_DOMAIN}}/privacy",
  ];
  for (const url of invalidUrls) {
    await assert.rejects(
      checkPublicPage("privacy", url, {
        fetchFn: () => {
          assert.fail("fetch must not run for invalid input");
        },
        lookupFn: PUBLIC_DNS,
      }),
      /URL|HTTPS|placeholder/i,
    );
  }
});

test("rejects a public hostname resolving to any private address", async () => {
  await assert.rejects(
    checkPublicPage("privacy", "https://joessh.dev/privacy", {
      fetchFn: () => {
        assert.fail("fetch must not run for private DNS");
      },
      lookupFn: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.10", family: 4 },
      ],
    }),
    /does not resolve only to public addresses/,
  );
});

test("binds the default HTTPS transport to the validated public DNS records", async () => {
  const validated = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ];
  let transportCall;
  const result = await checkPublicPage(
    "privacy",
    "https://joessh.dev/privacy",
    {
      boundFetchFn: async (url, init, addresses) => {
        transportCall = { addresses, init, url: url.href };
        return htmlResponse("privacy");
      },
      lookupFn: async () => validated,
    },
  );

  assert.equal(result.status, 200);
  assert.deepEqual(transportCall.addresses, validated);
  assert.equal(transportCall.url, "https://joessh.dev/privacy");
  assert.equal(transportCall.init.credentials, "omit");
  assert.equal(transportCall.init.redirect, "manual");
});

test("pinned socket lookup returns only the selected validated address", () => {
  const selected = { address: "93.184.216.34", family: 4 };
  const lookup = createPinnedLookup(selected);
  let single;
  let all;
  lookup("joessh.dev", { all: false }, (error, address, family) => {
    assert.equal(error, null);
    single = { address, family };
  });
  lookup("joessh.dev", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    all = addresses;
  });

  assert.deepEqual(single, selected);
  assert.deepEqual(all, [selected]);
});

test("rejects DNS records whose declared family does not match the address", async () => {
  await assert.rejects(
    checkPublicPage("privacy", "https://joessh.dev/privacy", {
      boundFetchFn: async () => assert.fail("transport must not run"),
      lookupFn: async () => [{ address: "93.184.216.34", family: 6 }],
    }),
    /does not resolve only to public addresses/,
  );
});

test("rejects status, authentication challenge, media type, download, and size failures", async (t) => {
  const fixtures = [
    [
      "not found",
      htmlResponse("privacy", { status: 404 }),
      /returned HTTP 404/,
    ],
    [
      "authentication challenge",
      htmlResponse("privacy", {
        headers: { "WWW-Authenticate": "Basic realm=private" },
      }),
      /authentication challenge/,
    ],
    [
      "JSON",
      new Response("{}", {
        headers: { "Content-Type": "application/json" },
      }),
      /must use text\/html/,
    ],
    [
      "non UTF-8",
      htmlResponse("privacy", {
        headers: { "Content-Type": "text/html; charset=iso-8859-1" },
      }),
      /must use UTF-8/,
    ],
    [
      "attachment",
      htmlResponse("privacy", {
        headers: { "Content-Disposition": "attachment; filename=privacy.html" },
      }),
      /served as a download/,
    ],
    [
      "oversize",
      htmlResponse("privacy", {
        headers: { "Content-Length": String(1024 * 1024 + 1) },
      }),
      /exceeds the 1048576-byte limit/,
    ],
  ];

  for (const [name, response, expected] of fixtures) {
    await t.test(name, async () => {
      await assert.rejects(
        checkPublicPage("privacy", "https://joessh.dev/privacy", {
          fetchFn: async () => response,
          lookupFn: PUBLIC_DNS,
        }),
        expected,
      );
    });
  }
});

test("rejects invalid UTF-8 response bodies", async () => {
  await assert.rejects(
    checkPublicPage("privacy", "https://joessh.dev/privacy", {
      fetchFn: async () =>
        new Response(new Uint8Array([0xff, 0xfe, 0xfd]), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      lookupFn: PUBLIC_DNS,
    }),
    /body is not valid UTF-8/,
  );
});

test("rejects incomplete, draft, placeholder, auth-wall, and role-mismatched HTML", async (t) => {
  const fixtures = [
    [
      "short",
      "<html><title>Privacy</title><body><h1>Privacy</h1></body></html>",
      /unexpectedly short/,
    ],
    [
      "placeholder",
      pageHtml("privacy", "<p>{{PARTNER_CENTER_PUBLISHER_DISPLAY_NAME}}</p>"),
      /still contains a placeholder/,
    ],
    [
      "draft",
      pageHtml("privacy", "<p>Publication status: fail-closed draft.</p>"),
      /still marked as a non-publishable source or draft/,
    ],
    [
      "Store draft",
      pageHtml(
        "privacy",
        "<p>Publication status: <strong>fail-closed Store draft</strong>.</p>",
      ),
      /still marked as a non-publishable source or draft/,
    ],
    [
      "Store source",
      pageHtml(
        "privacy",
        "<p>Publication status: <strong>fail-closed Store source</strong>.</p>",
      ),
      /still marked as a non-publishable source or draft/,
    ],
    [
      "blocked support route",
      pageHtml(
        "privacy",
        "<p>The Store release support route is <strong>still blocked</strong>.</p>",
      ),
      /still marked as a non-publishable source or draft/,
    ],
    [
      "auth wall",
      pageHtml("privacy", '<form class="login"><input type="password"></form>'),
      /authentication or challenge page/,
    ],
    ["wrong role", pageHtml("support"), /missing required privacy content/],
    [
      "missing date",
      pageHtml("privacy").replace("Last updated: 2026-08-01", "Current policy"),
      /missing a visible ISO/,
    ],
  ];

  for (const [name, body, expected] of fixtures) {
    await t.test(name, async () => {
      await assert.rejects(
        checkPublicPage("privacy", "https://joessh.dev/privacy", {
          fetchFn: async () => htmlResponse("privacy", { body }),
          lookupFn: PUBLIC_DNS,
        }),
        expected,
      );
    });
  }
});

test("requires the role-marked contact link itself to be usable", async (t) => {
  const valid = pageHtml(
    "privacy",
    '<p><a href="https://privacy.microsoft.com/privacystatement">Microsoft privacy</a></p>',
  );
  const fixtures = [
    valid.replace('data-joessh-contact="privacy" ', ""),
    valid.replace(
      'href="https://github.com/JoeWorkspace/JoeSSH/issues"',
      'href="#"',
    ),
    valid.replace(
      'data-joessh-contact="privacy"',
      'data-joessh-contact="support"',
    ),
    valid.replace(
      "</main>",
      '<a data-joessh-contact="privacy" href="mailto:privacy@joessh.dev">Privacy email</a></main>',
    ),
  ];

  for (const [index, body] of fixtures.entries()) {
    await t.test(`invalid marked contact ${index + 1}`, async () => {
      await assert.rejects(
        checkPublicPage("privacy", "https://joessh.dev/privacy", {
          fetchFn: async () => htmlResponse("privacy", { body }),
          lookupFn: PUBLIC_DNS,
        }),
        /marked contact link|contact link must use/,
      );
    });
  }
});

test("fails closed when privacy and support resolve to the same canonical page", async () => {
  const report = await checkStorePublicPages(
    {
      privacyUrl: "https://joessh.dev/policy",
      publisherDisplayName: "Joe Developer",
      supportUrl: "https://joessh.dev/policy",
    },
    {
      fetchFn: async () =>
        new Response(
          pageHtml("privacy").replace(
            "Optional telemetry is disabled unless the user opts in. Contact the publisher about privacy.",
            'Optional telemetry is disabled. Community support is best-effort. Open an issue and use the private security route. Contact the publisher about privacy and support. <a data-joessh-contact="support" href="https://github.com/JoeWorkspace/JoeSSH/issues">Support contact</a>',
          ),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
      lookupFn: PUBLIC_DNS,
    },
  );

  assert.equal(report.decision, "fail");
  assert.match(report.pages[0].error, /distinct canonical public pages/);
  assert.match(report.pages[1].error, /distinct canonical public pages/);
});

test("parses CLI flags and environment defaults deterministically", () => {
  assert.deepEqual(
    parseArgs([], {
      ATLASTERM_WINDOWS_LEGAL_PUBLISHER: "Joe Developer",
      JOESSH_PRIVACY_URL: "https://joessh.dev/privacy",
      JOESSH_SUPPORT_URL: "https://joessh.dev/support",
    }),
    {
      json: false,
      privacyUrl: "https://joessh.dev/privacy",
      publisherDisplayName: "Joe Developer",
      supportUrl: "https://joessh.dev/support",
    },
  );
  assert.deepEqual(
    parseArgs(
      [
        "--json",
        "--privacy-url=https://joessh.dev/p",
        "--support-url",
        "https://joessh.dev/s",
      ],
      {},
    ),
    {
      json: true,
      privacyUrl: "https://joessh.dev/p",
      publisherDisplayName: "",
      supportUrl: "https://joessh.dev/s",
    },
  );
  assert.throws(() => parseArgs(["--unknown"], {}), /Unknown argument/);
  assert.throws(
    () => parseArgs(["--privacy-url", "--json"], {}),
    /requires a value/,
  );
});

test("CLI exits closed when configured URLs are absent", () => {
  const result = spawnSync(process.execPath, [CHECKER_PATH], {
    encoding: "utf8",
    env: {
      ...process.env,
      JOESSH_PRIVACY_URL: "",
      JOESSH_SUPPORT_URL: "",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL Privacy public page/);
  assert.match(result.stderr, /FAIL Support public page/);
  assert.match(result.stdout, /Store public page check: FAIL/);
});

test("public URL parser rejects query-bearing URLs and invalid roles", async () => {
  assert.throws(
    () => parsePublicHttpsUrl("https://joessh.dev/privacy?token=secret"),
    /public HTTPS/,
  );
  await assert.rejects(
    checkPublicPage("terms", "https://joessh.dev/terms", {
      fetchFn: async () => assert.fail("must not fetch"),
      lookupFn: PUBLIC_DNS,
    }),
    /role must be privacy or support/,
  );
});
