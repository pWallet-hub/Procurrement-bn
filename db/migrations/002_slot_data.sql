-- slot level data (fields filled at a later signature, e.g. IM-08 decision) and re-submittable slots
ALTER TABLE signatures ADD COLUMN slot_data jsonb;
ALTER TABLE signature_slots DROP CONSTRAINT signature_slots_document_id_slot_key_key;
CREATE UNIQUE INDEX signature_slots_current ON signature_slots (document_id, slot_key) WHERE voided_at IS NULL;
