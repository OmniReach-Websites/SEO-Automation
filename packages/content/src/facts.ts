export interface FactEdit {
  actorId: string;
  factId: string;
  provenance: string;
  reason: string;
  role:
    | 'platform_owner'
    | 'platform_admin'
    | 'staff'
    | 'customer_owner'
    | 'customer_editor'
    | 'customer_viewer';
  value: string;
}

export function validateManualFactEdit(edit: FactEdit): FactEdit {
  if (!['platform_owner', 'platform_admin', 'staff', 'customer_owner'].includes(edit.role)) {
    throw new Error('Role cannot edit protected facts');
  }
  if (!edit.reason.trim() || !edit.provenance.trim())
    throw new Error('Fact edits require reason and provenance');
  return { ...edit, provenance: edit.provenance.trim(), reason: edit.reason.trim() };
}

export interface ProtectedFactRecord {
  id: string;
  provenance: string;
  value: string;
  version: number;
}

export interface ProtectedFactStore {
  transaction<T>(
    operation: (commands: {
      appendAudit(input: {
        actorId: string;
        after: ProtectedFactRecord;
        before: ProtectedFactRecord;
        reason: string;
      }): Promise<void>;
      updateFact(input: {
        expectedVersion: number;
        factId: string;
        provenance: string;
        value: string;
      }): Promise<{ after: ProtectedFactRecord; before: ProtectedFactRecord } | undefined>;
    }) => Promise<T>,
  ): Promise<T>;
}

export class ProtectedFactService {
  constructor(private readonly store: ProtectedFactStore) {}

  async update(edit: FactEdit & { expectedVersion: number }): Promise<ProtectedFactRecord> {
    const valid = validateManualFactEdit(edit);
    return this.store.transaction(async (commands) => {
      const result = await commands.updateFact({
        expectedVersion: edit.expectedVersion,
        factId: valid.factId,
        provenance: valid.provenance,
        value: valid.value,
      });
      if (!result) throw new Error('Protected fact revision is stale');
      await commands.appendAudit({
        actorId: valid.actorId,
        after: result.after,
        before: result.before,
        reason: valid.reason,
      });
      return result.after;
    });
  }
}
