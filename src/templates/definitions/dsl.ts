import { ComputedSpec, Condition, Field, FieldType } from '../types';

type Opt = Partial<Omit<Field, 'key' | 'type' | 'label'>>;
const mk = (type: FieldType) => (key: string, label: string, o: Opt = {}): Field => ({ key, type, label, ...o });
/** Options from labels (value = label in snake case) or [value, label] pairs (printed label differs from the stored value). */
type Opts = (string | [string, string])[];
const slug = (l: string) => l.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const opts = (list: Opts) => list.map((l) => (Array.isArray(l) ? { value: l[0], label: l[1] } : { value: slug(l), label: l }));

export const f = {
  text: mk('text'), textarea: mk('textarea'), date: mk('date'), time: mk('time'), number: mk('number'),
  money: mk('money'), file: mk('file'), yesno: mk('yes_no'), user: mk('user_ref'), supplier: mk('supplier_ref'),
  budget: mk('budget_line_ref'), caseRef: (key: string, label: string, o: Opt = {}) => mk('case_ref')(key, label, { readonly: true, ...o }),
  select: (key: string, label: string, list: Opts, o: Opt = {}) => mk('select')(key, label, { options: opts(list), ...o }),
  radio: (key: string, label: string, list: Opts, o: Opt = {}) => mk('radio')(key, label, { options: opts(list), ...o }),
  checks: (key: string, label: string, list: Opts, o: Opt = {}) => mk('checkbox_group')(key, label, { options: opts(list), ...o }),
  table: (key: string, label: string, columns: Field[], min: number, max: number, o: Opt = {}) => mk('table')(key, label, { columns, min_rows: min, max_rows: max, ...o }),
  computed: (key: string, label: string, computed: ComputedSpec, o: Opt = {}) => mk('computed')(key, label, { computed, readonly: true, ...o }),
};
export const req = { required: true } as const;
export const when = (field: string, v: { equals?: any; includes?: string; truthy?: boolean }): Condition => ({ field, ...v });
export const CURRENCIES = ['RWF', 'USD', 'EUR'];
export { opts };
