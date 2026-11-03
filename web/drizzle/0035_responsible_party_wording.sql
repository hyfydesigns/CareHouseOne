-- The starter forms say "responsible party" instead of "power of attorney" for the person filling them in.
-- Only the forms themselves, and only the starter wording: onboardings already sent keep what was sent (and signed).
UPDATE onboarding_forms
SET blocks = replace(replace(blocks::text, '"Power of attorney or guardian"', '"Responsible party"'), '{{POA name}}', '{{Responsible party}}')::jsonb,
    version = version + 1
WHERE blocks::text LIKE '%"Power of attorney or guardian"%' OR blocks::text LIKE '%{{POA name}}%';
--> statement-breakpoint
UPDATE onboarding_forms SET title = 'Responsible party and emergency contacts', version = version + 1 WHERE title = 'Power of attorney and emergency contacts';
--> statement-breakpoint
UPDATE onboarding_forms SET title = 'Photo ID of the responsible party', version = version + 1 WHERE title = 'Photo ID of the power of attorney';
