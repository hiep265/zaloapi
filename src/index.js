import { createServer } from 'http';
import app from './app.js';
import config from './config/index.js';
import { migrate } from './db/index.js';
import { startAllListeners } from './services/listenerManager.js';

async function start() {
  try {
    await migrate();
    // Start listeners for all active sessions
    await startAllListeners();
    const server = createServer(app);
    const port = config.port;
    server.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
