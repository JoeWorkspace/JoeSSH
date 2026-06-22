import { describe, expect, it } from 'vitest';

import {
  WEB_CONTENT_SECURITY_POLICY,
  WEB_HTTP_CONTENT_SECURITY_POLICY,
  WEB_PERMISSIONS_POLICY,
  applyPermissionsPolicy,
  applyWebContentSecurityPolicy,
  createWebContentSecurityPolicy,
  getAdminSnapshotConnectOrigin,
} from './csp';

describe('web Content Security Policy', () => {
  it('is well-formed: no malformed directive tokens (e.g. a stray trailing quote)', () => {
    // Regression guard for the shipped `upgrade-insecure-requests'` defect.
    expect(WEB_CONTENT_SECURITY_POLICY).toContain('upgrade-insecure-requests');
    expect(WEB_CONTENT_SECURITY_POLICY).not.toContain("upgrade-insecure-requests'");
    expect(WEB_CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors');
    expect(WEB_HTTP_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    // No directive should carry an empty quoted token like `'` on its own.
    for (const directive of WEB_CONTENT_SECURITY_POLICY.split(';')) {
      expect(directive.trim()).not.toMatch(/(^|\s)'\s*$/);
    }
  });

  it('keeps the default policy same-origin only for fixture and relative snapshot URLs', () => {
    expect(createWebContentSecurityPolicy()).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('/v1/admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
  });

  it('adds only the exact HTTP(S) origin for configured live admin snapshots', () => {
    expect(getAdminSnapshotConnectOrigin(' https://sync.example.com:8443/v1/admin/snapshot?team=atlas ')).toBe(
      'https://sync.example.com:8443',
    );
    expect(createWebContentSecurityPolicy('https://sync.example.com:8443/v1/admin/snapshot')).toContain(
      "connect-src 'self' https://sync.example.com:8443",
    );
  });

  it('ignores unsupported snapshot URL protocols', () => {
    expect(getAdminSnapshotConnectOrigin('javascript:alert(1)')).toBeUndefined();
    expect(createWebContentSecurityPolicy('file:///tmp/snapshot.json')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('//sync.example.com/v1/admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https://admin:secret@sync.example.com/v1/admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https:evil.com')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https:\\evil.com')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('http:////host')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('\\\\sync.example.com/v1/admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('/\\sync.example.com/v1/admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https://sync.example.com\\@evil.example/v1/admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https://sync.example.com/v1/admin snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https://sync.example.com/v1/\u0000admin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(createWebContentSecurityPolicy('https://sync.example.com/v1/\u009fadmin/snapshot')).toBe(WEB_CONTENT_SECURITY_POLICY);
    expect(getAdminSnapshotConnectOrigin(`https://sync.example.com/v1/${String.fromCodePoint(0x200b)}admin/snapshot`)).toBeUndefined();
    expect(createWebContentSecurityPolicy(`https://sync.example.com/v1/admin/${String.fromCodePoint(0x202e)}snapshot`)).toBe(
      WEB_CONTENT_SECURITY_POLICY,
    );
  });

  it('rewrites the HTML CSP meta tag with the generated policy', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'" />';
    const reorderedHtml = '<meta content="connect-src self" data-policy="legacy" http-equiv=\'Content-Security-Policy\'>';
    const similarAttributeHtml =
      '<meta data-http-equiv="Content-Security-Policy" content="legacy" />\n<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'" />';

    expect(applyWebContentSecurityPolicy(html, 'http://127.0.0.1:4110/v1/admin/snapshot')).toContain(
      "connect-src 'self' http://127.0.0.1:4110",
    );
    expect(applyWebContentSecurityPolicy(html)).toContain("base-uri 'self'; form-action 'self'");
    expect(applyWebContentSecurityPolicy(html)).not.toContain('frame-ancestors');
    expect(applyWebContentSecurityPolicy(reorderedHtml)).toContain(
      '<meta http-equiv="Content-Security-Policy" content=',
    );
    expect(applyWebContentSecurityPolicy(reorderedHtml)).not.toContain('data-policy="legacy"');
    expect(applyWebContentSecurityPolicy(similarAttributeHtml)).toContain(
      '<meta data-http-equiv="Content-Security-Policy" content="legacy" />',
    );
    expect(applyWebContentSecurityPolicy(similarAttributeHtml)).toContain(
      '<meta http-equiv="Content-Security-Policy" content=',
    );
  });

  it('injects the HTML CSP meta tag when the template is missing one', () => {
    const result = applyWebContentSecurityPolicy('<html><head><title>JoeSSH</title></head><body></body></html>');

    expect(result).toContain('<head>\n    <meta http-equiv="Content-Security-Policy"');
    expect(result).toContain(WEB_CONTENT_SECURITY_POLICY);
  });

  it('prepends the HTML CSP meta tag when no head element is present', () => {
    const result = applyWebContentSecurityPolicy('<main>JoeSSH</main>');

    expect(result.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(result).toContain('<main>JoeSSH</main>');
  });
});

describe('Permissions-Policy header', () => {
  const htmlWithCsp = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />';

  it('injects Permissions-Policy meta tag after CSP when none exists', () => {
    const result = applyPermissionsPolicy(htmlWithCsp);

    expect(result).toContain('http-equiv="Permissions-Policy"');
    expect(result).toContain(WEB_PERMISSIONS_POLICY);
    expect(result).toContain('camera=()');
    expect(result).toContain('microphone=()');
    expect(result).toContain('geolocation=()');
  });

  it('preserves an injected CSP connect-src origin when adding Permissions-Policy', () => {
    const withOrigin = applyWebContentSecurityPolicy(
      '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'" />',
      'https://sync.example.com:8443/v1/admin/snapshot',
    );

    expect(applyPermissionsPolicy(withOrigin)).toContain(
      "connect-src 'self' https://sync.example.com:8443",
    );
  });

  it('replaces existing Permissions-Policy meta tag', () => {
    const html = `${htmlWithCsp}\n    <meta http-equiv="Permissions-Policy" content="camera=*" />`;
    const reorderedHtml = "<meta content='camera=*' data-policy='legacy' http-equiv='Permissions-Policy'>";
    const similarAttributeHtml =
      '<meta data-http-equiv="Permissions-Policy" content="legacy" />\n<meta http-equiv="Permissions-Policy" content="camera=*" />';
    const result = applyPermissionsPolicy(html);
    const reorderedResult = applyPermissionsPolicy(reorderedHtml);
    const similarAttributeResult = applyPermissionsPolicy(similarAttributeHtml);

    expect(result).toContain(WEB_PERMISSIONS_POLICY);
    expect(result).not.toContain('camera=*');
    expect(reorderedResult).toContain(WEB_PERMISSIONS_POLICY);
    expect(reorderedResult).not.toContain("data-policy='legacy'");
    expect(similarAttributeResult).toContain('<meta data-http-equiv="Permissions-Policy" content="legacy" />');
    expect(similarAttributeResult).toContain(WEB_PERMISSIONS_POLICY);
    expect(similarAttributeResult).not.toContain('content="camera=*"');
  });

  it('injects Permissions-Policy into head when both policy meta tags are absent', () => {
    const result = applyPermissionsPolicy('<html><head><title>JoeSSH</title></head><body></body></html>');

    expect(result).toContain('<head>\n    <meta http-equiv="Permissions-Policy"');
    expect(result).toContain(WEB_PERMISSIONS_POLICY);
  });

  it('prepends Permissions-Policy when no head element is present', () => {
    const result = applyPermissionsPolicy('<main>JoeSSH</main>');

    expect(result.startsWith('<meta http-equiv="Permissions-Policy"')).toBe(true);
    expect(result).toContain('<main>JoeSSH</main>');
  });

  it('denies sensitive browser features by default', () => {
    expect(WEB_PERMISSIONS_POLICY).toContain('camera=()');
    expect(WEB_PERMISSIONS_POLICY).toContain('microphone=()');
    expect(WEB_PERMISSIONS_POLICY).toContain('geolocation=()');
    expect(WEB_PERMISSIONS_POLICY).toContain('payment=()');
    expect(WEB_PERMISSIONS_POLICY).toContain('usb=()');
  });
});
