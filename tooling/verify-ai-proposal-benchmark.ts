import { runSyntheticProposalBenchmark } from '@omnireach/ai';

const report = runSyntheticProposalBenchmark();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
