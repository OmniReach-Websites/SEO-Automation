import { describe, expect, it } from 'vitest';

// @ts-expect-error -- infrastructure tooling remains plain ESM until a tooling package exists.
import { checkProductionCompose } from '../../tooling/check-production-compose.mjs';

describe('production Compose contract', () => {
  it('keeps datastores persistent, private, authenticated, and resource-limited', () => {
    expect(checkProductionCompose()).toEqual({ errors: [], ok: true });
  });
});
