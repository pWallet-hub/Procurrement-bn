import { Condition } from './types';

/** `visible_if` / `required_if` of a field or section, evaluated against the document data (or a table row merged into it). */
export function cond(c: Condition | undefined, data: Record<string, any>): boolean {
  if (!c) return true;
  const v = data[c.field];
  if (c.equals !== undefined) return v === c.equals;
  if (c.includes !== undefined) return Array.isArray(v) && v.includes(c.includes);
  if (c.truthy !== undefined) return !!v === c.truthy;
  return true;
}
