# GitHub workflows

`ci.yml` is the branch and pull-request validation workflow established by G03. It has read-only repository permissions and contains no deployment job, production environment, SSH step, or production credential reference.

Deployment foundations belong to G19 and production activation belongs to G31. Neither may be added to this branch workflow.

`deploy-production.yml` is fail-closed preparation for G31. Push deployment requires an
explicit repository activation variable. Its manual bridge requires a separate checked
confirmation, exact candidate and rollback commits from `main` history, protected
production-environment approval, and independent build/test/package/metadata generation
from each checkout. Manual rollback is also inert unless separately confirmed and the
repository activation variable is enabled; it uses the same protected environment and
restricted SSH path. See
[`infrastructure/deploy/README.md`](../../infrastructure/deploy/README.md) for the
release-contract and compatibility policy. The workflow's presence and local tests do
not constitute live G31 evidence or authorization.
