-- The agreement's room number becomes optional, in the form itself and in onboardings not yet signed.
UPDATE onboarding_forms
SET blocks = (
  SELECT jsonb_agg(CASE WHEN e->>'type' = 'field' AND e->>'label' = 'Room number' THEN jsonb_set(e, '{required}', 'false') ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(e, ord)
),
version = version + 1
WHERE title = 'Residential Care Home Agreement' AND jsonb_array_length(blocks) > 0;
--> statement-breakpoint
UPDATE onboarding_items i
SET blocks = (
  SELECT jsonb_agg(CASE WHEN e->>'type' = 'field' AND e->>'label' = 'Room number' THEN jsonb_set(e, '{required}', 'false') ELSE e END ORDER BY ord)
  FROM jsonb_array_elements(i.blocks) WITH ORDINALITY AS t(e, ord)
)
WHERE i.title = 'Residential Care Home Agreement' AND jsonb_array_length(i.blocks) > 0 AND i.status <> 'approved'
  AND NOT EXISTS (SELECT 1 FROM onboarding_signatures s WHERE s.item_id = i.id AND s.voided_at IS NULL)
  AND EXISTS (SELECT 1 FROM onboarding_packets p WHERE p.id = i.packet_id AND p.status IN ('open', 'draft'));
