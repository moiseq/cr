const http = require('http');
const crypto = require('crypto');
const key = crypto.randomBytes(16).toString('base64');
const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/_next/webpack-hmr',
  headers: {
    'Connection': 'Upgrade',
    'Upgrade': 'websocket',
    'Sec-WebSocket-Key': key,
    'Sec-WebSocket-Version': '13'
  }
});
req.on('upgrade', (res, socket, upgradeHead) => {
  console.log('got upgraded!', res.statusCode);
  process.exit(0);
});
req.on('response', (res) => {
  console.log('got response', res.statusCode);
  process.exit(1);
});
req.on('error', (e) => {
  console.error('error', e);
  process.exit(1);
});
req.end();
