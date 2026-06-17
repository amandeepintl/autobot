import mineflayer from 'mineflayer';
import { logger } from '../logger.js';
import { config } from '../config.js';


async function start() {
  const workerType = process.env.WORKER_TYPE;
  if (!workerType) {
    console.error("Fatal: WORKER_TYPE environment variable not set.");
    process.exit(1);
  }

  logger.info(`RUNNER-${workerType.toUpperCase()}`, `Starting worker process for type: ${workerType}`);



  // 1. Dynamically import the corresponding worker plugin
  let pluginModule;
  try {
    const pluginPath = `../plugins/${workerType}/index.js`;
    pluginModule = await import(pluginPath);
  } catch (err) {
    logger.error(`RUNNER-${workerType.toUpperCase()}`, `Failed to import plugin: ${err.message}`);
    process.exit(1);
  }

  const PluginClass = pluginModule.default;
  if (!PluginClass) {
    logger.error(`RUNNER-${workerType.toUpperCase()}`, `Plugin module does not export a default class.`);
    process.exit(1);
  }

  // 2. Instantiate worker plugin
  const workerInstance = new PluginClass(workerType, config);

  // 3. Run diagnostics/bootstrap phases
  try {
    await workerInstance.bootstrap();
  } catch (err) {
    logger.error(`RUNNER-${workerType.toUpperCase()}`, `Bootstrap phase failed: ${err.message}`);
    process.exit(1);
  }

  // 4. Determine connection credentials
  let username = process.env.BOT_USERNAME || config.usernameRotation?.usernames?.[0] || "MWPBot";
  if (workerType === 'farmer' && config.farmer?.username) {
    username = config.farmer.username;
  }

  const host = process.env.MC_SERVER_HOST || config.server.host;
  const port = parseInt(process.env.MC_SERVER_PORT) || config.server.port;
  const version = process.env.MC_SERVER_VERSION || config.server.version;

  logger.info(`RUNNER-${workerType.toUpperCase()}`, `Connecting bot '${username}' to ${host}:${port} (v${version})...`);

  // 5. Connect mineflayer client
  let bot;
  try {
    bot = mineflayer.createBot({
      host,
      port,
      username,
      version,
      skipValidation: true
    });
  } catch (err) {
    logger.error(`RUNNER-${workerType.toUpperCase()}`, `Mineflayer instantiation failed: ${err.message}`);
    process.exit(1);
  }

  // 6. Bind connection handlers
  bot.once('spawn', async () => {
    logger.info(`RUNNER-${workerType.toUpperCase()}`, "Bot spawned. Initiating connection hook...");
    try {
      await workerInstance.connect(bot);
      
      // Let supervisor know we are ready
      if (process.send) {
        process.send({ type: 'ready', username });
      }
    } catch (err) {
      logger.error(`RUNNER-${workerType.toUpperCase()}`, `Worker connection activation failed: ${err.message}`);
      process.exit(1);
    }
  });

  bot.on('kicked', (reason) => {
    logger.warn(`RUNNER-${workerType.toUpperCase()}`, `Bot kicked from server: ${reason}`);
    process.exit(1);
  });

  bot.on('error', (err) => {
    logger.error(`RUNNER-${workerType.toUpperCase()}`, `Bot socket error: ${err.message}`);
  });

  bot.on('end', (reason) => {
    logger.warn(`RUNNER-${workerType.toUpperCase()}`, `Bot connection ended: ${reason}`);
    process.exit(1);
  });

  // 7. Graceful shutdown signals
  const shutdown = async (signal) => {
    logger.info(`RUNNER-${workerType.toUpperCase()}`, `Received ${signal}. Shutting down worker...`);
    try {
      await workerInstance.shutdown();
    } catch (err) {
      logger.error(`RUNNER-${workerType.toUpperCase()}`, `Shutdown execution failed: ${err.message}`);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error("Unhandled worker runner error:", err);
  process.exit(1);
});
