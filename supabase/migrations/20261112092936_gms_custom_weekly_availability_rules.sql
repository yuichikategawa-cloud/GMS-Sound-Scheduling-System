-- Add custom weekly recurrence support for servant availability restrictions.
-- Custom rules select one or more weekdays and repeat every N Monday-based weeks.
-- Existing rules retain their current behavior through the default column values.

ALTER TABLE public.servant_availability_rules
  ADD COLUMN IF NOT EXISTS weekdays smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interval_weeks smallint NOT NULL DEFAULT 1;

ALTER TABLE public.servant_availability_rules
  DROP CONSTRAINT IF EXISTS servant_availability_rules_pattern_check;

ALTER TABLE public.servant_availability_rules
  ADD CONSTRAINT servant_availability_rules_pattern_check
    CHECK (pattern IN ('weekday','saturday','sunday','second_week','nth_weekday','month_edges','custom_weekly'));

ALTER TABLE public.servant_availability_rules
  DROP CONSTRAINT IF EXISTS servant_availability_rules_interval_weeks_check,
  DROP CONSTRAINT IF EXISTS servant_availability_rules_weekdays_check,
  DROP CONSTRAINT IF EXISTS servant_availability_rules_custom_weekdays_required_check;

ALTER TABLE public.servant_availability_rules
  ADD CONSTRAINT servant_availability_rules_interval_weeks_check
    CHECK (interval_weeks BETWEEN 1 AND 52),
  ADD CONSTRAINT servant_availability_rules_weekdays_check
    CHECK (
      array_position(weekdays, NULL) IS NULL
      AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
    ),
  ADD CONSTRAINT servant_availability_rules_custom_weekdays_required_check
    CHECK (pattern <> 'custom_weekly' OR cardinality(weekdays) > 0);

COMMENT ON COLUMN public.servant_availability_rules.weekdays IS
  'Selected weekdays for custom_weekly recurrence (0=Sunday through 6=Saturday).';
COMMENT ON COLUMN public.servant_availability_rules.interval_weeks IS
  'Repeat interval for custom_weekly recurrence, anchored to the Monday of effective_from.';
