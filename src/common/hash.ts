import { createHash, randomBytes } from 'crypto';

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

/** Canonical JSON: sorted keys, no whitespace. Same input always gives the same bytes. */
export function canonical(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

export const randomToken = () => randomBytes(32).toString('hex'); // 256 bit

/** Hash of a frozen document: {template_code, template_version, data, attachment_hashes} (spec section 10) */
export function documentHash(templateCode: string, templateVersion: number, data: any, attachmentHashes: string[]): string {
  return sha256(canonical({ template_code: templateCode, template_version: templateVersion, data, attachment_hashes: [...attachmentHashes].sort() }));
}
