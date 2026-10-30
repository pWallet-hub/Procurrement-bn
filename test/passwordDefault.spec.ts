import { passwordLoginEnabled } from '../src/config/config';

// In production password sign-in is off unless it is switched on explicitly. Development keeps it on.
describe('password sign-in default', () => {
  it('is off in production', () => {
    expect(passwordLoginEnabled({ NODE_ENV: 'production' })).toBe(false);
  });
  it('is on in development', () => {
    expect(passwordLoginEnabled({ NODE_ENV: 'development' })).toBe(true);
  });
  it('can be switched on explicitly in production', () => {
    expect(passwordLoginEnabled({ NODE_ENV: 'production', PASSWORD_LOGIN: 'true' })).toBe(true);
  });
  it('can be switched off in development', () => {
    expect(passwordLoginEnabled({ NODE_ENV: 'development', PASSWORD_LOGIN: 'false' })).toBe(false);
  });
});
