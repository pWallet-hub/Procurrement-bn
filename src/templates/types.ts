export type FieldType =
  | 'text' | 'textarea' | 'date' | 'time' | 'number' | 'money' | 'select' | 'radio' | 'checkbox_group' | 'yes_no'
  | 'table' | 'file' | 'user_ref' | 'supplier_ref' | 'budget_line_ref' | 'computed' | 'case_ref';

export interface Condition { field: string; equals?: any; includes?: string; truthy?: boolean }

export interface ComputedSpec {
  op: 'mul' | 'sum_rows' | 'sum_mul' | 'add' | 'variance_mid';
  fields?: string[];        // mul: row columns · add: top level fields · variance_mid: [amountColumn, lowField, highField]
  table?: string;           // sum_rows / sum_mul: table key
  field?: string;           // sum_rows: column to add up
}

export interface Field {
  key: string; type: FieldType; label: string; help?: string;
  required?: boolean; required_if?: Condition; visible_if?: Condition; readonly?: boolean;
  options?: { value: string; label: string }[]; allow_other?: boolean;
  min?: number; max?: number; maxLength?: number; exclusive_min?: boolean;
  columns?: Field[]; min_rows?: number; max_rows?: number;
  accept?: string[];
  computed?: ComputedSpec; format?: 'money';
  default?: any;
  /** key of the signature slot at which this top level field is filled (e.g. the decision on IM-08). Frozen at submit otherwise. */
  fill_at?: string;
}

export interface Section { key: string; title: string; description?: string; fields: Field[]; visible_if?: Condition }

export interface SlotDef {
  key: string; label: string; role: string; seq: number; group?: string; declaration: string;
  assign?: 'creator' | 'case_requester'; external?: boolean;
}

export interface WorkflowDef {
  guards_on_submit: string[];
  guards_on_sign: string[];
  requires_conflict_confirmation: boolean;
  footer_note?: string;
}

export interface TemplateDef {
  code: string; version: number; title: string; description: string;
  schema: { sections: Section[] };
  signature_slots: SlotDef[];
  workflow: WorkflowDef;
}
