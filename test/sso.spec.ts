import * as jwt from 'jsonwebtoken';

// SSO is configured from the environment when config loads, so set it before the modules are required.
process.env.AFS_SSO_ENABLED = 'true';
process.env.AFS_OIDC_ISSUER = 'http://localhost:8081/realms/afs';
process.env.AFS_OIDC_CLIENT_ID = 'procurement';
process.env.AFS_OIDC_CLIENT_SECRET = 'test-client-secret-value';
process.env.AFS_COMMAND_CENTER_URL = 'http://backend:8000';
process.env.AFS_SERVICE_TOKEN = 'test-service-token-value-1234';
process.env.APP_URL = 'http://localhost:5173';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SsoService, safeNextPath, readCookie, SSO_STATE } = require('../src/sso/sso.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config } = require('../src/config/config');

// The flow does not touch the database for these checks, so the dependencies are not needed.
const sso = new SsoService(null, null, null);

describe('safeNextPath', () => {
  it('keeps same-site paths', () => {
    expect(safeNextPath('/cases/123')).toBe('/cases/123');
  });
  it('sends anything that could leave the site to the home page', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'cases', '', undefined, '/a\nb']) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });
});

describe('readCookie', () => {
  it('finds the named cookie among several', () => {
    expect(readCookie('a=1; procurement_sso=abc.def.ghi; b=2', SSO_STATE.cookie)).toBe('abc.def.ghi');
  });
  it('returns undefined when absent', () => {
    expect(readCookie(undefined, SSO_STATE.cookie)).toBeUndefined();
    expect(readCookie('a=1', SSO_STATE.cookie)).toBeUndefined();
  });
});

describe('sign-in start', () => {
  it('sends PKCE and a state bound to a cookie, with no silent flag by default', () => {
    const { url, cookie } = sso.start('/cases', false);
    const params = new URL(url).searchParams;
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('prompt')).toBeNull();
    expect(url.startsWith(`${config.sso.issuer}/protocol/openid-connect/auth`)).toBe(true);
    expect(sso.readState(cookie)).toMatchObject({ state: params.get('state'), nonce: params.get('nonce'), next: '/cases' });
  });

  it('asks Keycloak not to show a form when silent', () => {
    const { url } = sso.start('/', true);
    expect(new URL(url).searchParams.get('prompt')).toBe('none');
  });
});

describe('state cookie', () => {
  it('is refused when altered', () => {
    const { cookie } = sso.start('/', false);
    const tampered = jwt.sign({ typ: 'sso_state', state: 'x', nonce: 'y', verifier: 'z', next: '/' }, 'not-the-real-secret');
    expect(sso.readState(tampered)).toBeNull();
    expect(sso.readState(cookie.slice(0, -2) + 'xx')).toBeNull();
  });

  it('is refused when it is not a sign-in state', () => {
    const other = jwt.sign({ typ: 'access', sub: 'someone' }, config.jwtRefreshSecret);
    expect(sso.readState(other)).toBeNull();
  });
});
