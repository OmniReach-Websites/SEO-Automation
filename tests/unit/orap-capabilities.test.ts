import {
  getOrapCapability,
  isAssignableOrapCapability,
  isRegisteredOrapCapability,
  orapCapabilityCatalog,
  orapRoleTemplates,
} from '@omnireach/auth';
import { describe, expect, it } from 'vitest';

describe('ORAP capability catalog', () => {
  it('uses unique stable keys with complete policy metadata', () => {
    const keys = orapCapabilityCatalog.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(60);
    for (const definition of orapCapabilityCatalog) {
      expect(definition.key).toMatch(/^[a-z][a-z0-9_.]+$/u);
      expect(definition.description.length).toBeGreaterThan(10);
      expect(definition.version).toBeGreaterThan(0);
    }
  });

  it('makes owner-only capabilities permanently ineligible for role grants', () => {
    for (const definition of orapCapabilityCatalog.filter(({ ownerOnly }) => ownerOnly)) {
      expect(definition.requiresReason).toBe(true);
      expect(definition.requiresStrongStepUp).toBe(true);
      expect(definition.risk).toBe('critical');
      expect(isAssignableOrapCapability(definition.key)).toBe(false);
    }
    expect(isAssignableOrapCapability('staff.invite')).toBe(false);
    expect(isAssignableOrapCapability('owners.manage')).toBe(false);
  });

  it('defines valid least-privilege templates without owner-only grants', () => {
    expect(orapRoleTemplates.map(({ slug }) => slug)).toContain('platform-owner');
    expect(orapRoleTemplates.map(({ slug }) => slug)).toContain('platform-admin');
    expect(orapRoleTemplates).toHaveLength(11);
    for (const template of orapRoleTemplates) {
      expect(new Set(template.permissionKeys).size).toBe(template.permissionKeys.length);
      for (const key of template.permissionKeys) {
        expect(isRegisteredOrapCapability(key)).toBe(true);
        expect(getOrapCapability(key)?.ownerOnly).toBe(false);
      }
    }
    expect(
      orapRoleTemplates.find(({ slug }) => slug === 'content-editor')?.permissionKeys,
    ).not.toContain('websites.content.publish');
    expect(
      orapRoleTemplates.find(({ slug }) => slug === 'support-representative')?.permissionKeys,
    ).not.toContain('staff.invite');
  });

  it('denies unknown future capabilities until they are registered and assigned', () => {
    expect(isRegisteredOrapCapability('future.module.launch')).toBe(false);
    expect(isAssignableOrapCapability('future.module.launch')).toBe(false);
    expect(getOrapCapability('future.module.launch')).toBeUndefined();
  });
});
