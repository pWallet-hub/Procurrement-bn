-- The director_dept role is titled "Manager of Department". Labels are display text only (the document hash covers
-- the form code, version, data and attachments, not labels), so stored copies of the old title are renamed too:
-- signature boxes already created on documents, earlier form versions, and the position of demo/seeded accounts.
UPDATE signature_slots
   SET label = replace(label, 'Director of Department', 'Manager of Department')
 WHERE label LIKE '%Director of Department%';

UPDATE form_templates
   SET signature_slots = replace(signature_slots::text, 'Director of Department', 'Manager of Department')::jsonb,
       schema = replace(replace(schema::text, 'Director of Department', 'Manager of Department'), 'DIRECTOR OF DEPARTMENT', 'MANAGER OF DEPARTMENT')::jsonb
 WHERE signature_slots::text LIKE '%Director of Department%'
    OR schema::text LIKE '%Director of Department%'
    OR schema::text LIKE '%DIRECTOR OF DEPARTMENT%';

UPDATE roles SET description = 'Manager of Department' WHERE code = 'director_dept';

UPDATE users SET position = 'Manager of Department' WHERE position = 'Director of Department';
