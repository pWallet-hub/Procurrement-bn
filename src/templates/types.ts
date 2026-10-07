export type FieldType =
  | 'text' | 'textarea' | 'date' | 'time' | 'number' | 'money' | 'select' | 'radio' | 'checkbox_group' | 'yes_no'
  | 'table' | 'file' | 'user_ref' | 'supplier_ref' | 'budget_line_ref' | 'computed' | 'case_ref';

export interface Condition { field: string; equals?: any; includes?: string; truthy?: boolean }

export interface ComputedSpec {
  op: 'mul' | 'sum_rows' | 'sum_mul' | 'add' | 'add_times' | 'variance_mid';
  fields?: string[];        // mul: row columns · add / add_times: top level fields · variance_mid: [amountColumn, lowField, highField]
  table?: string;           // sum_rows / sum_mul: table key
  field?: string;           // sum_rows: column to add up · add_times: top level number the sum is multiplied by
}

export interface Field {
  key: string; type: FieldType; label: string; help?: string;
  required?: boolean; required_if?: Condition; visible_if?: Condition; readonly?: boolean;
  options?: { value: string; label: string }[]; allow_other?: boolean;
  min?: number; max?: number; maxLength?: number; exclusive_min?: boolean;
  columns?: Field[]; min_rows?: number; max_rows?: number;
  accept?: string[];
  computed?: ComputedSpec; format?: 'money';
  default?: any;               // value for new drafts; the keyword "today" on a date field fills the creation date
  /** key of the signature slot at which this top level field is filled (e.g. the decision on IM-08). Frozen at submit otherwise. */
  fill_at?: string;
  /** extra value rule; `id_document`: Rwanda national ID or passport number, chosen by the radio field `type_field` */
  check?: { rule: 'id_document'; type_field: string };
}

export interface Section { key: string; title: string; description?: string; fields: Field[]; visible_if?: Condition }

export interface SlotDef {
  key: string; label: string; role: string; seq: number; group?: string; declaration: string;
  /** who signs: the creator, the case requester, or the user picked in a user_ref field (`field:<key>`); otherwise anyone with the role */
  assign?: 'creator' | 'case_requester' | `field:${string}`; external?: boolean;
}

export interface WorkflowDef {
  guards_on_submit: string[];
  guards_on_sign: string[];
  requires_conflict_confirmation: boolean;
  footer_note?: string;
}

/** How the form is laid out on paper / in the paper view (mirrors the printed AfS-Rwanda forms in /temp) */
export interface PaperMeta {
  layout: 'form' | 'contract';
  form_label: string;            // "FORM: <form_label>" in the header box
  title: string;                 // upper case title as printed
  version: string;               // "Version: 1.0"
  date_label: string;            // Effective | Issue Date | Date | Date Submitted
  org: string;                   // left header cell
  footer: string;                // centred footer line
  intro?: string;                // small paragraph under the header
  signoff_before?: string;       // section key the sign-off grid is printed before (default: after all sections)
  signoff_title: string;         // heading above the Name / Signature / Date grid
  notes?: string;                // italic note under the sign-off grid
}

export interface TemplateDef {
  code: string; version: number; title: string; description: string;
  schema: { sections: Section[]; paper?: PaperMeta };
  signature_slots: SlotDef[];
  workflow: WorkflowDef;
}
