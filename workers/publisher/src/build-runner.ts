import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface SiteBuildResult {
  durationMs: number;
  output: string;
  workspace: string;
}

export async function runSiteBuild(input: {
  contentSnapshotPath?: string;
  maxOutputBytes?: number;
  npmExecPath?: string;
  outputDirectory?: string;
  repositoryRoot: string;
  timeoutMs?: number;
  workspace: string;
}): Promise<SiteBuildResult> {
  if (!/^@omnireach\/site-[a-z0-9-]+$/u.test(input.workspace)) {
    throw new Error('Invalid site workspace');
  }
  const npmExecPath = input.npmExecPath ?? process.env.npm_execpath;
  if (!npmExecPath) throw new Error('Trusted npm executable path is unavailable');
  const repositoryRoot = resolve(input.repositoryRoot);
  const timeoutMs = input.timeoutMs ?? 120_000;
  const maxOutputBytes = input.maxOutputBytes ?? 1_000_000;
  const startedAt = Date.now();
  const contentSnapshotPath = input.contentSnapshotPath
    ? resolve(input.contentSnapshotPath)
    : undefined;
  if (contentSnapshotPath && !(await stat(contentSnapshotPath)).isFile()) {
    throw new Error('Content snapshot file is unavailable');
  }
  const outputDirectory = input.outputDirectory ? resolve(input.outputDirectory) : undefined;

  return new Promise<SiteBuildResult>((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve(npmExecPath),
        'run',
        'build',
        '--workspace',
        input.workspace,
        ...(outputDirectory ? ['--', '--outDir', outputDirectory] : []),
      ],
      {
        cwd: repositoryRoot,
        env: buildEnvironment(contentSnapshotPath),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else
        resolveResult({
          durationMs: Date.now() - startedAt,
          output: Buffer.concat(chunks).toString('utf8'),
          workspace: input.workspace,
        });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Site build timed out'));
    }, timeoutMs);
    timer.unref();
    const capture = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(new Error('Site build exceeded output limit'));
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      if (code === 0) finish();
      else finish(new Error(`Site build failed (code=${String(code)}, signal=${String(signal)})`));
    });
  });
}

function buildEnvironment(contentSnapshotPath?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    NODE_OPTIONS: '--max-old-space-size=512',
  };
  if (contentSnapshotPath) environment.OMNIREACH_CONTENT_SNAPSHOT = contentSnapshotPath;
  for (const key of ['ComSpec', 'PATH', 'SystemRoot', 'TEMP', 'TMP'] as const) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}
