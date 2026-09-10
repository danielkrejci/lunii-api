-- Opening balance, and grandfathering what is already on people's screens.
--
-- Every existing reader starts full. There is no "before" to be fair about, and
-- someone who has used the app for months should not open it to an empty tank.

INSERT INTO credit_accounts (user_id, balance, balance_updated_at)
SELECT id, 24, now() FROM "user"
ON CONFLICT (user_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO credit_ledger (id, user_id, delta, balance_after, reason, created_at)
SELECT gen_random_uuid()::text, ca.user_id, 24, 24, 'initial_grant', now()
FROM credit_accounts ca
WHERE NOT EXISTS (
    SELECT 1 FROM credit_ledger cl
    WHERE cl.user_id = ca.user_id AND cl.reason = 'initial_grant'
);
--> statement-breakpoint

-- Anything already generated stays open, at a cost of zero.
--
-- Without this, every reader would be asked to pay again for a horoscope that is
-- already written and already on their screen. The zero cost is what stops a later
-- refund handing back credits that were never taken.

INSERT INTO credit_unlocks (id, user_id, feature, resource_key, credits_spent)
SELECT gen_random_uuid()::text, user_id, 'dailyInsight', date::text, 0
FROM daily_insights WHERE status = 'ready'
ON CONFLICT (user_id, feature, resource_key) DO NOTHING;
--> statement-breakpoint

INSERT INTO credit_unlocks (id, user_id, feature, resource_key, credits_spent)
SELECT gen_random_uuid()::text, user_id, 'moonInsight', date::text, 0
FROM moon_insights WHERE status = 'ready'
ON CONFLICT (user_id, feature, resource_key) DO NOTHING;
--> statement-breakpoint

INSERT INTO credit_unlocks (id, user_id, feature, resource_key, credits_spent)
SELECT gen_random_uuid()::text, user_id, 'planetInsight', date::text, 0
FROM planet_insights WHERE status = 'ready'
ON CONFLICT (user_id, feature, resource_key) DO NOTHING;
--> statement-breakpoint

-- Compatibility scores carry the person, not the reader, so this one needs the join.
INSERT INTO credit_unlocks (id, user_id, feature, resource_key, credits_spent)
SELECT gen_random_uuid()::text, p.user_id, 'compatibilityDetail', s.person_id || ':' || s.date::text, 0
FROM compatibility_people_scores s
JOIN compatibility_people p ON p.id = s.person_id
WHERE s.status = 'ready'
ON CONFLICT (user_id, feature, resource_key) DO NOTHING;

-- Chat is not backfilled: charging starts with the next send.
