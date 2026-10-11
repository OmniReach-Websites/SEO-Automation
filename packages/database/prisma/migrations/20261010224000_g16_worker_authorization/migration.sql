-- Publication execution re-checks the requesting actor's current role. RLS limits
-- each caller to the row identified by app.user_id; this grant does not expose the
-- platform membership directory.
GRANT SELECT ON platform_memberships TO omnireach_app, omnireach_worker;
