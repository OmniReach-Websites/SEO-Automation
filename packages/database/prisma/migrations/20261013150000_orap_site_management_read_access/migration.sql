-- ORAP needs this single read to show whether a site's immutable artifact is active.
-- Keep publication mutation authority with the application and worker roles.
REVOKE ALL ON TABLE active_artifacts FROM omnireach_platform;
GRANT SELECT ON TABLE active_artifacts TO omnireach_platform;
