import { logger } from './logger.js';
import { storageManager } from './storageManager.js';
import { config } from './config.js';

class ServerDetection {
  constructor() {
    this.filePath = "data/serverProfile.json";
    this.profile = {
      serverType: "unknown",
      pluginsDetected: [],
      schemaVersion: 1
    };
    this.bot = null;
  }

  init(bot) {
    this.bot = bot;
    
    // Load historical server profile
    try {
      const parsed = storageManager.read(this.filePath, this.profile);
      this.profile = { ...this.profile, ...parsed.data };
      logger.info("DETECTION", `Loaded server profile: ${JSON.stringify(this.profile)}`);
    } catch (_) {}

    this.registerEvents();
  }

  registerEvents() {
    this.bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString().trim();
      this.scanMessage(text);
    });

    this.bot.on('login', () => {
      // Check brand channel for ViaVersion or server type
      const brand = this.bot.game?.serverBrand;
      if (brand) {
        logger.info("DETECTION", `Server brand detected: ${brand}`);
        if (brand.toLowerCase().includes('viaversion')) {
          this.addPlugin('ViaVersion');
        }
        if (brand.toLowerCase().includes('paper') || brand.toLowerCase().includes('spigot') || brand.toLowerCase().includes('velocity')) {
          this.profile.serverType = brand;
          this.save();
        }
      }
    });
  }

  scanMessage(text) {
    // AuthMe detection
    if (text.includes('/register') || text.includes('/login') || text.includes('log in') || text.includes('register with')) {
      if (!this.profile.pluginsDetected.includes('AuthMe')) {
        logger.info("DETECTION", "AuthMe login/register plugin detected!");
        this.addPlugin('AuthMe');
        this.handleAuthMeLogin();
      } else {
        this.handleAuthMeLogin();
      }
    }

    // Essentials detection
    if (text.includes('Essentials') || text.includes('/help Essentials') || text.includes('warp') || text.includes('tpa') || text.includes('home')) {
      if (text.includes('/') && !this.profile.pluginsDetected.includes('Essentials')) {
        logger.info("DETECTION", "Essentials plugin detected!");
        this.addPlugin('Essentials');
      }
    }
  }

  addPlugin(name) {
    if (!this.profile.pluginsDetected.includes(name)) {
      this.profile.pluginsDetected.push(name);
      this.save();
    }
  }

  handleAuthMeLogin() {
    if (!this.bot) return;
    
    const password = config.server.password || "AutoBotPass123";
    
    // Simple delay to look natural and wait for spawn
    setTimeout(() => {
      try {
        logger.info("DETECTION", "Sending AuthMe login command...");
        this.bot.chat(`/login ${password}`);
        
        // Also try register in case bot is new
        setTimeout(() => {
          this.bot.chat(`/register ${password} ${password}`);
        }, 1000);
      } catch (err) {
        logger.error("DETECTION", `Failed to send AuthMe login command: ${err.message}`);
      }
    }, 1500);
  }

  save() {
    try {
      storageManager.write(this.filePath, this.profile, 1);
    } catch (err) {
      logger.error("DETECTION", `Failed to save server profile: ${err.message}`);
    }
  }
}

export const serverDetection = new ServerDetection();
