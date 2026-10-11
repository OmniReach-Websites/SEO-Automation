import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDocument } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const workflowsDirectory = resolve(root, '.github', 'workflows');
const immutableAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;
const forbiddenBranchCiText = /(?:\bssh\b|\bscp\b|\brsync\b|deploy(?:ment)?|environment\s*:)/i;

function visit(value, callback, path = []) {
  callback(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, callback, [...path, String(index)]));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => visit(entry, callback, [...path, key]));
  }
}

export function checkWorkflows(directory = workflowsDirectory) {
  const errors = [];
  const files = readdirSync(directory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort();

  if (files.length === 0) errors.push('no workflow YAML files found');

  for (const file of files) {
    const source = readFileSync(resolve(directory, file), 'utf8');
    const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
    if (document.errors.length > 0) {
      errors.push(...document.errors.map((error) => `${file}: ${error.message}`));
      continue;
    }

    const workflow = document.toJS();
    const isBranchCi = file === 'ci.yml';
    const isReusableDeploy = file === 'deploy-artifact.yml';
    if (isBranchCi && (!workflow?.on?.push || !Object.hasOwn(workflow.on, 'pull_request'))) {
      errors.push(`${file}: branch CI must run for pushes and pull requests`);
    }
    if (isReusableDeploy && !Object.hasOwn(workflow?.on ?? {}, 'workflow_call')) {
      errors.push(`${file}: inert deploy foundation must be reusable only`);
    }
    if (!isBranchCi && !isReusableDeploy)
      errors.push(`${file}: workflow is not registered by policy`);
    if (workflow?.pull_request_target) errors.push(`${file}: pull_request_target is forbidden`);
    if (
      workflow?.permissions?.contents !== 'read' ||
      Object.keys(workflow.permissions).length !== 1
    ) {
      errors.push(`${file}: top-level permissions must be exactly contents: read`);
    }
    if (isBranchCi && forbiddenBranchCiText.test(source))
      errors.push(`${file}: branch CI contains deployment/production/SSH text`);
    if (
      isReusableDeploy &&
      Object.values(workflow?.jobs ?? {}).some(
        (job) => job && typeof job === 'object' && Object.hasOwn(job, 'environment'),
      )
    ) {
      errors.push(`${file}: reusable foundation must not bind a production environment`);
    }
    if (
      isReusableDeploy &&
      (!source.includes('StrictHostKeyChecking=yes') || !source.includes('known_hosts'))
    ) {
      errors.push(`${file}: reusable foundation must pin and strictly verify the SSH host key`);
    }

    visit(workflow, (value, path) => {
      if (path.at(-1) === 'uses' && typeof value === 'string') {
        const action = value.split(/\s+#/u)[0];
        if (!immutableAction.test(action))
          errors.push(`${file}: action is not pinned to a SHA: ${value}`);
      }
      if (path.includes('permissions') && typeof value === 'string' && value.includes('write')) {
        errors.push(`${file}: write permission is forbidden at ${path.join('.')}`);
      }
    });
  }

  return { errors, files, ok: errors.length === 0 };
}

export function main() {
  const result = checkWorkflows();
  console.log(JSON.stringify({ check: 'workflows', ...result }));
  return result.ok ? 0 : 1;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main();
