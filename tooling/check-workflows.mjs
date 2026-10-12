import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDocument } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const workflowsDirectory = resolve(root, '.github', 'workflows');
const immutableAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/;
const forbiddenBranchCiText = /(?:\bssh\b|\bscp\b|\brsync\b|deploy(?:ment)?|environment\s*:)/i;

function includesEvery(value, fragments) {
  return typeof value === 'string' && fragments.every((fragment) => value.includes(fragment));
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

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
    const branchCiSource = source.replace(
      'node infrastructure/deploy/create-release-metadata.mjs --check-contract',
      '',
    );
    if (isBranchCi && forbiddenBranchCiText.test(branchCiSource))
      errors.push(`${file}: branch CI contains deployment/production/SSH text`);
    if (
      isBranchCi &&
      !source.includes('node infrastructure/deploy/create-release-metadata.mjs --check-contract')
    ) {
      errors.push(`${file}: branch CI must validate source release capabilities`);
    }
    const expectedFullSecretScans = isProductionDeploy ? 3 : 1;
    if (
      source.includes('scan:secrets -- --full-history') ||
      occurrences(source, 'npm run scan:secrets -- --scope full') !== expectedFullSecretScans
    ) {
      errors.push(`${file}: every source path must use the supported full secret-scan scope`);
    }
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
      if (Object.hasOwn(workflow?.on ?? {}, 'pull_request')) {
        errors.push(`${file}: pull requests must never trigger production operations`);
      }
      const jobs = workflow?.jobs ?? {};
      if (
        Object.keys(jobs).sort().join(',') !== 'bridge,deploy,rollback' ||
        jobs.bridge?.environment !== 'production' ||
        jobs.deploy?.environment !== 'production' ||
        jobs.rollback?.environment !== 'production'
      ) {
        errors.push(`${file}: deploy, bridge, and rollback must bind the production environment`);
      }
      if (
        jobs.deploy?.if !==
        "${{ github.event_name == 'push' && vars.PRODUCTION_DEPLOYMENT_ENABLED == 'true' }}"
      ) {
        errors.push(`${file}: production deployment must default off behind explicit activation`);
      }
      if (
        !includesEvery(jobs.rollback?.if, [
          "github.event_name == 'workflow_dispatch'",
          "github.ref == 'refs/heads/main'",
          "inputs.operation == 'rollback'",
          'inputs.confirm_rollback == true',
          "vars.PRODUCTION_DEPLOYMENT_ENABLED == 'true'",
        ]) ||
        !source.includes('omnireach-release rollback')
      ) {
        errors.push(`${file}: rollback must be main-only and default off behind both gates`);
      }
      const dispatchInputs = workflow.on.workflow_dispatch?.inputs ?? {};
      if (
        dispatchInputs.candidate_sha?.type !== 'string' ||
        dispatchInputs.rollback_sha?.type !== 'string' ||
        dispatchInputs.confirm_bridge?.type !== 'boolean' ||
        dispatchInputs.confirm_bridge?.default !== false ||
        dispatchInputs.confirm_rollback?.type !== 'boolean' ||
        dispatchInputs.confirm_rollback?.default !== false ||
        dispatchInputs.operation?.default !== 'rollback' ||
        !dispatchInputs.operation?.options?.includes('bridge') ||
        !dispatchInputs.operation?.options?.includes('rollback')
      ) {
        errors.push(`${file}: production dispatch inputs must default both operations off`);
      }
      if (
        !includesEvery(jobs.bridge?.if, [
          "github.event_name == 'workflow_dispatch'",
          "github.ref == 'refs/heads/main'",
          "inputs.operation == 'bridge'",
          'inputs.confirm_bridge == true',
          "vars.PRODUCTION_DEPLOYMENT_ENABLED == 'true'",
        ])
      ) {
        errors.push(`${file}: bridge must be main-only and default off behind both gates`);
      }
      const historyCheckout = jobs.bridge?.steps?.find(
        (step) => step?.name === 'Check out main history for ancestry verification',
      );
      if (
        historyCheckout?.with?.ref !== '${{ github.sha }}' ||
        historyCheckout?.with?.['fetch-depth'] !== 0 ||
        historyCheckout?.with?.['persist-credentials'] !== false
      ) {
        errors.push(`${file}: bridge ancestry verification must use the pinned workflow commit`);
      }
      const candidateCheckout = jobs.bridge?.steps?.find(
        (step) => step?.name === 'Check out exact candidate source',
      );
      const rollbackCheckout = jobs.bridge?.steps?.find(
        (step) => step?.name === 'Check out exact reviewed rollback source',
      );
      if (
        candidateCheckout?.with?.ref !== '${{ inputs.candidate_sha }}' ||
        candidateCheckout?.with?.path !== 'candidate-source' ||
        rollbackCheckout?.with?.ref !== '${{ inputs.rollback_sha }}' ||
        rollbackCheckout?.with?.path !== 'rollback-source'
      ) {
        errors.push(`${file}: bridge artifacts must use separate exact-source checkouts`);
      }
      if (
        !source.includes('merge-base --is-ancestor "${CANDIDATE_SHA}" refs/remotes/origin/main') ||
        !source.includes('merge-base --is-ancestor "${ROLLBACK_SHA}" refs/remotes/origin/main') ||
        !source.includes('merge-base --is-ancestor "${ROLLBACK_SHA}" "${CANDIDATE_SHA}"') ||
        !source.includes('working-directory: candidate-source') ||
        !source.includes('working-directory: rollback-source') ||
        !source.includes('omnireach-release bridge ${CANDIDATE_SHA} ${ROLLBACK_SHA}')
      ) {
        errors.push(`${file}: bridge must prove main ancestry and build both exact sources`);
      }
      if (
        !source.includes('test "${rollback_crypto}" -eq "${candidate_crypto}"') ||
        !source.includes('sh "${validator}" supports "${rollback_metadata}" "${ROLLBACK_SHA}"') ||
        !source.includes('sh "${validator}" supports "${candidate_metadata}" "${CANDIDATE_SHA}"')
      ) {
        errors.push(`${file}: bridge must preflight both release contracts before transfer`);
      }
      if (
        !source.includes('release_manifest=infrastructure/deploy/release-contract.json') ||
        !source.includes('if test -f "${release_manifest}"; then') ||
        !source.includes('"${RELEASE_SHA}" omnireach-release.meta . "${release_manifest}"') ||
        !source.includes(
          '../bridge-verification/infrastructure/deploy/legacy-release-contract-v2.json',
        )
      ) {
        errors.push(
          `${file}: bridge rollback metadata must prefer the exact source manifest and use the legacy contract only when absent`,
        );
      }
      const metadataGeneratorCount =
        occurrences(source, 'node infrastructure/deploy/create-release-metadata.mjs') +
        occurrences(
          source,
          'node ../bridge-verification/infrastructure/deploy/create-release-metadata.mjs',
        );
      if (
        metadataGeneratorCount < 4 ||
        occurrences(source, 'npm run verify:goal -- G05') < 3 ||
        occurrences(source, 'npm run verify:goal -- G06') < 3 ||
        occurrences(source, 'npm run verify:goal -- G30') < 3
      ) {
        errors.push(`${file}: candidate and rollback must independently pass gates and metadata`);
      }
      if (!source.includes('omnireach-release deploy ${GITHUB_SHA}')) {
        errors.push(`${file}: production deployment must activate the exact pushed SHA`);
      }
      if (!source.includes('${TARGET_USER}@${TARGET_HOST}:/opt/servers/omnireach/incoming/')) {
        errors.push(`${file}: production artifacts must use the fixed target incoming directory`);
      }
      if (!source.includes('StrictHostKeyChecking=yes') || !source.includes('known_hosts')) {
        errors.push(`${file}: production operations must strictly verify the SSH host key`);
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
