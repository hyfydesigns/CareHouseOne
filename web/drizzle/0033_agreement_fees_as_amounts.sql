-- The agreement's fee questions become "Amount ($)" answers, shown as currency (e.g. $1,000.00).
-- Only the forms themselves: onboardings already sent keep exactly what was sent (and signed).
UPDATE onboarding_forms
SET blocks = (
  SELECT jsonb_agg(
    CASE WHEN e->>'type' = 'field' AND e->>'label' IN ('Community fee', 'Monthly fee') AND e->>'input' = 'text'
      THEN jsonb_set(jsonb_set(e, '{input}', '"money"'), '{help}', to_jsonb(CASE e->>'label' WHEN 'Community fee' THEN 'One-time, non-refundable. For example: 1000' ELSE 'For example: 2500' END))
      ELSE e END
    ORDER BY ord)
  FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(e, ord)
),
version = version + 1
WHERE title = 'Residential Care Home Agreement' AND jsonb_array_length(blocks) > 0;
