-- 014_fix_sub_org_live_index.sql
-- Subscriptions in 'created' status have not been authorized or charged yet.
-- Including 'created' in ux_sub_org_live prevented users from retrying checkout
-- if an earlier attempt was abandoned or interrupted.

-- 1. Mark any stale 'created' subscriptions as 'cancelled' so they don't block active subscriptions
UPDATE subscriptions
   SET status = 'cancelled', updated_at = now()
 WHERE status = 'created';

-- 2. Drop the old index that included 'created'
DROP INDEX IF EXISTS ux_sub_org_live;

-- 3. Re-create the unique index ensuring at most one truly live subscription per organisation
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_org_live ON subscriptions(organisation_id)
    WHERE status IN ('authenticated','active','pending','halted','paused');
