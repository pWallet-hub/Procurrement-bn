/** Roles (spec section 4) and the permission codes each one holds. Seeded into role_permissions; edit the table, not the code, afterwards. */
export const ROLES: Record<string, string> = {
  requesting_staff: 'Requesting staff',
  accountant: 'Accountant / procurement focal person',
  director_comms: 'Director of Communications',
  director_dept: 'Director of Department',
  pi: 'Principal Investigator',
  cfm: 'Chief Finance Manager',
  market_verifier: 'Market Verification Officer',
  superior: 'Superior staff (IM-08 decision)',
  admin: 'System administrator',
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  requesting_staff: ['case.create', 'document.edit', 'slot.sign', 'audit.read_own'],
  accountant: ['case.create', 'document.edit', 'quotation.manage', 'slot.sign', 'po.generate', 'payment.record', 'case.view_all', 'case.configure', 'audit.read_all', 'reports.view', 'supplier.manage'],
  director_comms: ['case.create', 'document.edit', 'slot.sign', 'audit.read_own'],
  director_dept: ['case.create', 'document.edit', 'slot.sign', 'audit.read_own'],
  pi: ['case.create', 'document.edit', 'slot.sign', 'case.view_all', 'audit.read_all', 'reports.view'],
  cfm: ['slot.sign', 'payment.record', 'case.view_all', 'case.advance_arrangement', 'audit.read_all', 'reports.view'],
  market_verifier: ['document.edit', 'mpv.fill', 'slot.sign', 'audit.read_own'],
  superior: ['document.edit', 'slot.sign', 'case.create', 'audit.read_own'],
  admin: [], // every permission, filled in below
};
/** The administrator holds every permission any role has, plus the admin-only ones. */
ROLE_PERMISSIONS.admin = [...new Set(['admin.manage', 'budget.manage', ...Object.values(ROLE_PERMISSIONS).flat()])].sort();

/** Roles that see every case (object level rule, spec section 4) */
export const GLOBAL_ROLES = ['pi', 'accountant', 'cfm', 'admin'];
/** Roles that must use TOTP when TOTP_REQUIRED=true */
export const APPROVER_ROLES = ['pi', 'cfm', 'director_comms', 'director_dept', 'accountant', 'superior'];
