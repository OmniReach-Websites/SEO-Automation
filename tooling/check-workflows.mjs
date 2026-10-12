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
    const isProductionDeploy = file === 'deploy-production.yml';
    if (isBranchCi && (!workflow?.on?.push || !Object.hasOwn(workflow.on, 'pull_request'))) {
      errors.push(`${file}: branch CI must run for pushes and pull requests`);
    }
    if (isReusableDeploy && !Object.hasOwn(workflow?.on ?? {}, 'workflow_call')) {
      errors.push(`${file}: inert deploy foundation must be reusable only`);
    }
    if (isReusableDeploy) {
      const activation = workflow?.on?.workflow_call?.inputs?.production_deployment_enabled;
      if (activation?.required !== true || activation?.type !== 'boolean') {
        errors.push(`${file}: reusable production transfer must require explicit activation`);
      }
      if (workflow?.jobs?.transfer?.if !== '${{ inputs.production_deployment_enabled == true }}') {
        errors.push(`${file}: reusable production transfer must default off`);
      }
    }
    if (!isBranchCi && !isReusableDeploy && !isProductionDeploy)
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
    if (isProductionDeploy) {
      if (workflow?.on?.push?.branches?.length !== 1 || workflow.on.push.branches[0] !== 'main') {
        errors.push(`${file}: production deployment must trigger only from main`);
      }
      if (!Object.hasOwn(workflow?.on ?? {}, 'workflow_dispatch')) {
        errors.push(`${file}: production recovery must expose an explicit manual dispatch`);
      }
      const jobs = workflow?.jobs ?? {};
      if (
        Object.keys(jobs).sort().join(',') !== 'deploy,rollback' ||
        jobs.deploy?.environment !== 'production' ||
        jobs.rollback?.environment !== 'production'
      ) {
        errors.push(`${file}: deploy and rollback must bind the production environment`);
      }
      if (
        jobs.deploy?.if !==
        "${{ github.event_name == 'push' && vars.PRODUCTION_DEPLOYMENT_ENABLED == 'true' }}"
      ) {
        errors.push(`${file}: production deployment must default off behind explicit activation`);
      }
      if (
        jobs.rollback?.if !==
          "${{ github.event_name == 'workflow_dispatch' && inputs.operation == 'rollback' }}" ||
        !source.includes('omnireach-release rollback')
      ) {
        errors.push(`${file}: rollback must be an environment-reviewed manual operation`);
      }
      if (!source.includes('omnireach-release deploy ${GITHUB_SHA}')) {
        errors.push(`${file}: production deployment must activate the exact pushed SHA`);
      }
      if (!source.includes('${TARGET_USER}@${TARGET_HOST}:/opt/servers/omnireach/incoming/')) {
        errors.push(`${file}: production artifacts must use the fixed target incoming directory`);
      }
    }
    if (
      isReusableDeploy &&
      (!source.includes('StrictHostKeyChecking=yes') || !source.includes('known_hosts'))
    ) {
      errors.push(`${file}: reusable foundation must pin and strictly verify the SSH host key`);
    }
    if (isReusableDeploy) {
      if (!source.includes('omnireach-release deploy ${GITHUB_SHA}')) {
        errors.push(`${file}: reusable deployment must use the restricted deploy operation`);
      }
      if (!source.includes('${TARGET_USER}@${TARGET_HOST}:/opt/servers/omnireach/incoming/')) {
        errors.push(`${file}: reusable artifacts must use the fixed target incoming directory`);
      }
    }
    if (isReusableDeploy || isProductionDeploy) {
      if (
        !source.includes(
          'docker compose --file infrastructure/compose/dev.compose.yml up --detach --wait',
        ) ||
        !source.includes(
          'docker compose --file infrastructure/compose/dev.compose.yml down --volumes --remove-orphans',
        ) ||
        !source.includes('npm run verify:local-stack')
      ) {
        errors.push(
          `${file}: full release verification must manage its disposable dependency stack`,
        );
      }
      const activationIndex = source.indexOf('omnireach-release deploy ${GITHUB_SHA}');
      for (const goal of ['G05', 'G06', 'G30']) {
        const goalIndex = source.indexOf(`npm run verify:goal -- ${goal}`);
        if (goalIndex < 0 || activationIndex < 0 || goalIndex > activationIndex) {
          errors.push(`${file}: ${goal} must pass before production activation`);
        }
      }
      if (
        !source.includes('node infrastructure/deploy/create-release-metadata.mjs') ||
        !source.includes('omnireach-images.tar.gz.sha256 omnireach-release.meta')
      ) {
        errors.push(`${file}: immutable release metadata must be generated and packaged`);
      }
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
