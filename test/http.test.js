// The real HTTPS transport against loopback servers with test certificates:
// the only sockets of the tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { createHttpsTransport, certificateId } from '../src/syncbox/https.js';
import { SyncBoxClient } from '../src/syncbox/client.js';
import { FakeBox, serveBox, tlsFile } from './helpers/fakeBox.js';

const TEST_CA = tlsFile('ca.pem');

async function withBox(options, run) {
  const box = new FakeBox();
  const served = await serveBox(box, options);
  const transport = createHttpsTransport({ ca: TEST_CA, timeoutMs: 2000 });
  try {
    await run({ box, port: served.port, transport });
  } finally {
    transport.close();
    await served.close();
  }
}

const client = (transport, port, extra = {}) =>
  new SyncBoxClient({ host: '127.0.0.1', port, token: 'token-1', transport, ...extra });

test('the expected box, its certificate issued by the trusted CA: the state is read', async () => {
  await withBox({}, async ({ port, transport }) => {
    const c = client(transport, port, { uniqueId: 'C42996000000' });
    const state = await c.getState();
    assert.equal(state.device.uniqueId, 'C42996000000');
    // Several requests on the kept-alive connection.
    await c.setExecution({ mode: 'passthrough' });
    assert.equal((await c.getState()).execution.mode, 'passthrough');
  });
});

test('first contact with a typed address: the id of the certificate is kept', async () => {
  await withBox({}, async ({ port, transport }) => {
    const c = client(transport, port);
    const { uniqueId } = await c.probe(); // the box refuses /device without a token
    assert.equal(uniqueId, 'C42996000000');
    assert.equal(c.uniqueId, 'C42996000000');
  });
});

test('another genuine box answering at the address is refused', async () => {
  await withBox({ cert: 'other' }, async ({ port, transport }) => {
    await assert.rejects(client(transport, port, { uniqueId: 'C42996000000' }).getState(), {
      kind: 'identity',
    });
  });
});

test('a self-signed certificate with the right name is refused', async () => {
  await withBox({ cert: 'selfsigned' }, async ({ port, transport }) => {
    await assert.rejects(client(transport, port, { uniqueId: 'C42996000000' }).getState(), {
      kind: 'certificate',
    });
    await assert.rejects(client(transport, port).probe(), { kind: 'certificate' });
  });
});

test('by default only the Sync Box root CA is trusted (a test CA is not)', async () => {
  const box = new FakeBox();
  const served = await serveBox(box);
  const transport = createHttpsTransport({ timeoutMs: 2000 });
  try {
    await assert.rejects(client(transport, served.port, { uniqueId: 'C42996000000' }).getState(), {
      kind: 'certificate',
    });
  } finally {
    transport.close();
    await served.close();
  }
});

test('no answer: unreachable; a silent server: timeout; a huge answer: refused', async () => {
  const transport = createHttpsTransport({ ca: TEST_CA, timeoutMs: 300 });
  try {
    // A closed port.
    const closed = await serveBox(new FakeBox());
    const port = closed.port;
    await closed.close();
    await assert.rejects(client(transport, port).getState(), { kind: 'unreachable' });

    // A server that never answers.
    const silent = https.createServer(
      { cert: tlsFile('box.pem'), key: tlsFile('box.key') },
      () => {},
    );
    await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
    await assert.rejects(
      client(transport, silent.address().port, { uniqueId: 'C42996000000' }).getState(),
      { kind: 'unreachable', message: 'ETIMEDOUT' },
    );
    silent.closeAllConnections();
    await new Promise((resolve) => silent.close(resolve));

    // An answer far bigger than a state.
    const huge = https.createServer(
      { cert: tlsFile('box.pem'), key: tlsFile('box.key') },
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`"${'x'.repeat(400 * 1024)}"`);
      },
    );
    await new Promise((resolve) => huge.listen(0, '127.0.0.1', resolve));
    await assert.rejects(
      client(transport, huge.address().port, { uniqueId: 'C42996000000' }).getState(),
      { kind: 'protocol' },
    );
    huge.closeAllConnections();
    await new Promise((resolve) => huge.close(resolve));
  } finally {
    transport.close();
  }
});

test('the id of a certificate', () => {
  assert.equal(certificateId({ subject: { CN: 'c42996000000' } }), 'C42996000000');
  assert.equal(certificateId({ subject: { CN: ['C42996000000', 'x'] } }), 'C42996000000');
  assert.equal(certificateId({ subject: { CN: 'root-hsb' } }), undefined);
  assert.equal(certificateId({}), undefined);
});
