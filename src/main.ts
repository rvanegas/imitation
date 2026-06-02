import { diagProcessStart } from './diag';
diagProcessStart();

const [,, cmd, ...args] = process.argv;

function usage(): never {
  console.error('Usage: npm run dev <server [--no-telegram|-t] | terminal <name> | costs [--by-session|-s] | sessions | experiment <name>>');
  process.exit(1);
}

switch (cmd) {
  case 'server': {
    const noTelegram = args.includes('--no-telegram') || args.includes('-t');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./server').start(!noTelegram);
    break;
  }
  case 'terminal': {
    const name = args[0];
    if (!name) {
      console.error('Usage: npm run dev terminal <name>');
      process.exit(1);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./client').start(name);
    break;
  }
  case 'costs': {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const costs = require('./costs');
    if (args.includes('--by-session') || args.includes('-s')) {
      costs.showBySession();
    } else {
      costs.showSummary();
    }
    break;
  }
  case 'sessions': {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sessions').showSessions();
    break;
  }
  case 'experiment': {
    const scenarioName = args[0];
    process.argv = [process.argv[0], scenarioName, ...args.slice(1)];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../experiments/run');
    break;
  }
  default:
    usage();
}
