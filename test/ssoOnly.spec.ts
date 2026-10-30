// Production runs AFS-only: with PASSWORD_LOGIN=false no password can be used to sign in, be invited, or be changed.
process.env.PASSWORD_LOGIN = 'false';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AuthService } = require('../src/auth/auth.service');

// The guards run before any database access, so the dependencies are not needed.
const auth = new AuthService(null, null, null);

describe('AFS-only mode', () => {
  it('refuses password sign-in', async () => {
    await expect(auth.login('someone@afs.example', 'any-password', null)).rejects.toMatchObject({ code: 'auth.sso_only' });
  });

  it('refuses password changes and invitations that set a password', async () => {
    await expect(auth.changePassword({ id: 'u' }, 'old', 'new-password-123', null)).rejects.toMatchObject({ code: 'auth.sso_only' });
    await expect(auth.acceptInvite('token', 'new-password-123', null)).rejects.toMatchObject({ code: 'auth.sso_only' });
  });

  it('sends no invitation email, because there is nothing to set up', async () => {
    await expect(auth.createInvite('u')).resolves.toBeUndefined();
  });
});
