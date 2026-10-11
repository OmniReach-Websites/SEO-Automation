import type { SiteContract } from '@omnireach/contracts';

export interface EditorField {
  aiMode: 'auto' | 'suggestion' | 'disabled';
  editable: boolean;
  id: string;
  label: string;
  protected: boolean;
  type: SiteContract['fields'][number]['type'];
  value: unknown;
}

export function editorFields(input: {
  contract: SiteContract;
  editingEnabled: boolean;
  role: string;
  values: Record<string, unknown>;
}): EditorField[] {
  return input.contract.fields.map((field) => ({
    aiMode: field.aiMode,
    editable:
      input.editingEnabled && !field.protected && field.editableBy.includes(input.role as never),
    id: field.id,
    label: field.label,
    protected: field.protected,
    type: field.type,
    value: input.values[field.id],
  }));
}

export function canPublish(role: string, explicitEditorGrant: boolean): boolean {
  return role === 'customer_owner' || (role === 'customer_editor' && explicitEditorGrant);
}

export function renderEditor(fields: readonly EditorField[], draftVersion: number): string {
  const controls = fields.map((field) => renderControl(field)).join('');
  return `<form method="post" action="/editor/draft"><input type="hidden" name="expectedVersion" value="${draftVersion}">${controls}<button type="submit">Save draft</button></form><p id="protected-note">Unavailable fields cannot be changed from this editor.</p>`;
}

function renderControl(field: EditorField): string {
  const id = escapeHtml(field.id);
  const disabled = field.editable ? '' : ' disabled aria-describedby="protected-note"';
  const serialized = escapeHtml(
    typeof field.value === 'string' ? field.value : JSON.stringify(field.value ?? ''),
  );
  let control: string;
  switch (field.type) {
    case 'text':
      control = `<label for="${id}">Text</label><input id="${id}" name="${id}" type="text" value="${serialized}"${disabled}>`;
      break;
    case 'richText':
      control = `<label for="${id}">Formatted text</label><textarea id="${id}" name="${id}" data-format="structured-rich-text"${disabled}>${serialized}</textarea>`;
      break;
    case 'image':
      control = `<label for="${id}">Approved media asset</label><input id="${id}" name="${id}" type="text" value="${serialized}" aria-describedby="${id}-image-note"${disabled}><small id="${id}-image-note">Choose an uploaded, validated asset and provide alt text in the media workflow.</small>`;
      break;
    case 'link':
      control = `<label for="${id}">Safe link</label><input id="${id}" name="${id}" type="url" value="${serialized}" inputmode="url"${disabled}>`;
      break;
    case 'visibility':
      control = `<label><input id="${id}" name="${id}" type="checkbox" value="true"${field.value === true ? ' checked' : ''}${disabled}> Show this section</label>`;
      break;
    case 'theme': {
      const selected = typeof field.value === 'string' ? field.value : 'default';
      control = `<label for="${id}">Approved theme</label><select id="${id}" name="${id}"${disabled}>${[
        'default',
        'light',
        'dark',
      ]
        .map(
          (option) =>
            `<option value="${option}"${selected === option ? ' selected' : ''}>${option}</option>`,
        )
        .join('')}</select>`;
      break;
    }
    case 'sectionOrder':
      control = `<label for="${id}">Section order</label><textarea id="${id}" name="${id}" data-format="stable-id-list"${disabled}>${serialized}</textarea><small>Use only the listed stable section IDs; keyboard move controls are applied after loading.</small>`;
      break;
    case 'cards':
      control = `<label for="${id}">Card list</label><textarea id="${id}" name="${id}" data-format="structured-cards"${disabled}>${serialized}</textarea>`;
      break;
    case 'metadata':
      control = `<label for="${id}">Search metadata</label><textarea id="${id}" name="${id}" data-format="structured-metadata"${disabled}>${serialized}</textarea>`;
      break;
  }
  return `<fieldset data-field-type="${field.type}"><legend>${escapeHtml(field.label)}</legend>${control}<small>${field.protected ? 'Verified business fact; use the authorized fact workflow.' : `AI mode: ${field.aiMode}`}</small></fieldset>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
