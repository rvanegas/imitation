import * as dotenv from 'dotenv';
dotenv.config();

const [,, cmd, ...args] = process.argv;

function usage(): never {
  console.error('Usage: npm run dev <bot|server|terminal|client> [args]');
  process.exit(1);
}

switch (cmd) {
  case 'bot': {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bot, initSessions } = require('./bot');
    initSessions();
    bot.launch();
    console.log('Bot running.');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    break;
  }
  case 'server':
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./server').start();
    break;
  case 'terminal':
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./terminal').start();
    break;
  case 'client': {
    const name = args[0];
    if (!name) {
      console.error('Usage: npm run dev client <name>');
      process.exit(1);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./client').start(name);
    break;
  }
  default:
    usage();
}
