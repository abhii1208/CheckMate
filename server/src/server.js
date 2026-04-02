const app = require('./app');
const db = require('./config/db');

const PORT = process.env.PORT || 5000;

async function startServer() {
  await db.initializeDatabase();

  const server = app.listen(PORT, () => {
    const { mode, message } = db.getConnectionInfo();
    console.log(`CheckMate API listening on port ${PORT} (${mode} mode)`);
    console.log(message);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is already in use. Another CheckMate API instance is probably already running.`);
      console.warn('Stop the old server first or change PORT in server/.env if you want a second instance.');
      return;
    }

    console.error('Server error:', error.message);
    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error('Failed to start CheckMate API:', error.message);
  process.exit(1);
});
