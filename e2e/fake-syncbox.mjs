// -----------------------------------------------------------------------------
// A fake Sync Box for the end-to-end check: the FakeBox of the tests over
// HTTPS on port 443 (test certificate, CN C42996000000, issued by the test
// CA), and a plain HTTP control port 8080 for the check script:
//   /press           press the button (the next registration succeeds)
//   /set?mode=video  a change made outside Gladys (any execution key)
//   /down, /up       stop / start answering
//   /requests        the API requests received, as JSON
// -----------------------------------------------------------------------------

import http from 'node:http';
import { FakeBox, serveBox } from '../test/helpers/fakeBox.js';

const box = new FakeBox({ tokens: [] });
const served = await serveBox(box, { host: '0.0.0.0', port: 443 });
let down = false;
served.server.on('connection', (socket) => {
  if (down) socket.destroy();
});

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://control');
    const reply = (data) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    switch (url.pathname) {
      case '/press':
        box.pressButton();
        return reply({ pressed: true });
      case '/set': {
        const changes = Object.fromEntries(url.searchParams);
        box.set(changes);
        return reply(box.execution);
      }
      case '/down':
        down = true;
        served.server.closeAllConnections();
        return reply({ down });
      case '/up':
        down = false;
        return reply({ down });
      case '/requests':
        return reply(box.requests.map((r) => `${r.method} ${r.resource}`));
      default:
        res.writeHead(404);
        return res.end();
    }
  })
  .listen(8080, '0.0.0.0');

console.log('fake Sync Box on :443 (control :8080)');
