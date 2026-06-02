import * as path from 'path';

const [scenarioName] = process.argv.slice(1);

const SCENARIOS: Record<string, string> = {
  'context-growth': './scenarios/context-growth',
  'cache-efficiency': './scenarios/cache-efficiency',
  'compaction': './scenarios/compaction',
  'profile-richness': './scenarios/profile-richness',
};

async function main(): Promise<void> {
  if (!scenarioName || !SCENARIOS[scenarioName]) {
    console.error(`Usage: npm run experiment <scenario>`);
    console.error(`Available scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const modulePath = path.resolve(__dirname, SCENARIOS[scenarioName]);
  const mod = require(modulePath);
  await mod.run();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
