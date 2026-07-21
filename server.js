'use strict';

const { createServer } = require('./src/app');
const { loadConfig } = require('./src/config');

const config = loadConfig();
const server = createServer(config);

server.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' ? '<IP tohoto zařízení>' : config.host;
  console.log(`${config.householdName}: http://${shownHost}:${config.port}`);
  if (config.host === '0.0.0.0') {
    console.log('Aplikace je dostupná v lokální síti. Nezapínejte port forwarding na routeru.');
  }
});
