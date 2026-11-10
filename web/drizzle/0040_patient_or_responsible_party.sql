-- The care home agreement's last part is for the "Patient or Responsible Party" to sign.
-- Only the forms themselves: onboardings already sent keep what was sent (and signed).
UPDATE onboarding_forms
SET blocks = replace(replace(blocks::text, '"Legal Representative or Responsible Party"', '"Patient or Responsible Party"'), '"Legal representative or responsible party"', '"Patient or responsible party"')::jsonb,
    version = version + 1
WHERE blocks::text LIKE '%"Legal Representative or Responsible Party"%' OR blocks::text LIKE '%"Legal representative or responsible party"%';
