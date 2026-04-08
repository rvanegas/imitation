import * as dotenv from 'dotenv';
dotenv.config();

const [,, cmd, ...args] = process.argv;

function usage(): never {
  console.error('Usage: npm run dev <server [--no-telegram|-t] | terminal <name>>');
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
  default:
    usage();
}
