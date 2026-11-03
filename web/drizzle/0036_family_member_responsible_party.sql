-- A responsible party can be a family member without legal papers: a choice for it, and the papers upload becomes optional.
-- Only the forms themselves: onboardings already sent keep what was sent.
UPDATE onboarding_forms
SET blocks = (
  SELECT jsonb_agg(
    CASE WHEN e->>'type' = 'field' AND e->>'label' = 'Your authority' AND e->>'input' = 'choice' AND NOT (e->'options' ? 'Family member (no legal papers)')
      THEN jsonb_set(e, '{options}', COALESCE((
        SELECT jsonb_agg(o ORDER BY n) FROM (
          SELECT o, CASE WHEN o #>> '{}' = 'Other' THEN n + 0.5 ELSE n END AS n FROM jsonb_array_elements(e->'options') WITH ORDINALITY AS x(o, n)
          UNION ALL SELECT '"Family member (no legal papers)"'::jsonb, (SELECT COALESCE(MIN(n), 1000) FROM jsonb_array_elements(e->'options') WITH ORDINALITY AS y(o, n) WHERE o #>> '{}' = 'Other')
        ) z), '[]'::jsonb))
      ELSE e END
    ORDER BY ord)
  FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(e, ord)
),
version = version + 1
WHERE blocks::text LIKE '%"Your authority"%' AND blocks::text NOT LIKE '%Family member (no legal papers)%';
--> statement-breakpoint
UPDATE onboarding_forms
SET required = false,
    description = 'A copy of the signed power of attorney or the court''s guardianship order, if you have one.',
    version = version + 1
WHERE title = 'Power of attorney or guardianship papers' AND kind = 'upload'
  AND description = 'A copy of the signed power of attorney or the court''s guardianship order.';
