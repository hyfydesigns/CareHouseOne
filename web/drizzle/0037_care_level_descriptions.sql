-- The agreement's care level choices each get their description, in the form itself and in onboardings not yet signed.
UPDATE onboarding_forms
SET blocks = (
  SELECT jsonb_agg(CASE WHEN e->>'type' = 'field' AND e->>'label' = 'Care level' AND e->>'input' = 'choice' AND e->'options' ? 'Care Level A' AND e->'options' ? 'Care Level B'
    THEN jsonb_set(e, '{optionHelp}', '{"Care Level A": "For residents who are able to maintain a high degree of independence, with minimal personal assistance and/or interventions or redirection.", "Care Level B": "For residents who require more assistance and/or interventions or redirection with activities of daily living than Level A residents."}'::jsonb) ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(e, ord)
),
version = version + 1
WHERE title = 'Residential Care Home Agreement' AND jsonb_array_length(blocks) > 0 AND blocks::text NOT LIKE '%optionHelp%';
--> statement-breakpoint
UPDATE onboarding_items i
SET blocks = (
  SELECT jsonb_agg(CASE WHEN e->>'type' = 'field' AND e->>'label' = 'Care level' AND e->>'input' = 'choice' AND e->'options' ? 'Care Level A' AND e->'options' ? 'Care Level B'
    THEN jsonb_set(e, '{optionHelp}', '{"Care Level A": "For residents who are able to maintain a high degree of independence, with minimal personal assistance and/or interventions or redirection.", "Care Level B": "For residents who require more assistance and/or interventions or redirection with activities of daily living than Level A residents."}'::jsonb) ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(i.blocks) WITH ORDINALITY AS t(e, ord)
)
WHERE i.title = 'Residential Care Home Agreement' AND jsonb_array_length(i.blocks) > 0 AND i.status <> 'approved'
  AND NOT EXISTS (SELECT 1 FROM onboarding_signatures s WHERE s.item_id = i.id AND s.voided_at IS NULL)
  AND EXISTS (SELECT 1 FROM onboarding_packets p WHERE p.id = i.packet_id AND p.status IN ('open', 'draft'));
