const path = require('path');

process.env.NODE_ENV = 'production';
process.chdir(__dirname);

const currentPort = Number.parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || '127.0.0.1';
const { config: nextConfig } = require('./.next/required-server-files.json');

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

require('next');
const { startServer } = require('next/dist/server/lib/start-server');

startServer({
  dir: path.join(__dirname),
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
