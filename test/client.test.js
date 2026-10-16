import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncBoxClient, answerError } from '../src/syncbox/client.js';
import { fromNetworkError, reasonOf } from '../src/syncbox/errors.js';
import { FakeBox, fakeTransport } from './helpers/fakeBox.js';

const setup = () => {
  const box = new FakeBox();
  const transport = fakeTransport({ '192.168.1.12': box });
  const client = new SyncBoxClient({
    host: '192.168.1.12',
    uniqueId: 'C42996000000',
    token: 'token-1',
    transport,
  });
  return { box, transport, client };
};

test('the requests: path, token, JSON body', async () => {
  const { box, transport, client } = setup();
  await client.getState();
  await client.setExecution({ hdmiSource: 'input2' });
  await client.setGroupActive('db7dd240-d061-48bf-84c2-01f086e4bfae', false);
  assert.deepEqual(
    transport.calls.map((c) => `${c.method} ${c.path} ${c.expectedId}`),
    [
      'GET /api/v1 C42996000000',
      'PUT /api/v1/execution C42996000000',
      'PUT /api/v1/hue/groups/db7dd240-d061-48bf-84c2-01f086e4bfae C42996000000',
    ],
  );
  assert.deepEqual(
    box.requests.map((r) => [r.authorized, r.data]),
    [
      [true, undefined],
      [true, { hdmiSource: 'input2' }],
      [true, { active: false }],
    ],
  );
  assert.equal(box.execution.hdmiSource, 'input2');
});

test('registration: Invalid State until the button is pressed, never with a token', async () => {
  const { box, client } = setup();
  await assert.rejects(client.register(), { kind: 'state', code: 16 });
  box.pressButton();
  const credentials = await client.register();
  assert.deepEqual(credentials, { registrationId: '2', accessToken: 'token-2' });
  assert.deepEqual(box.requests.at(-1), {
    method: 'POST',
    resource: '/registrations',
    authorized: false,
    data: { appName: 'Gladys Assistant', instanceName: 'Gladys' },
  });
});

test('error answers -> kinds', async () => {
  const { client, box } = setup();
  await assert.rejects(client.setExecution({ volume: 3 }), {
    kind: 'refused',
    code: 13,
    message: '13: Invalid Key',
  });
  box.tokens.clear();
  await assert.rejects(client.getState(), { kind: 'auth', code: 1 });
  assert.equal(answerError({ status: 500, body: '<html>' }).kind, 'protocol');
  assert.equal(answerError({ status: 403, body: '' }).kind, 'auth');
  assert.equal(answerError({ status: 400, body: '{"code":2,"message":"x"}' }).kind, 'auth');
  const noToken = new SyncBoxClient({ host: '192.168.1.12', transport: fakeTransport({}) });
  await assert.rejects(noToken.getState(), { kind: 'auth', message: 'not registered' });
});

test('network errors -> kinds, reasons without secrets', () => {
  assert.equal(fromNetworkError({ code: 'ECONNREFUSED' }).kind, 'unreachable');
  assert.equal(fromNetworkError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }).kind, 'certificate');
  assert.equal(fromNetworkError({ code: 'ERR_SYNCBOX_IDENTITY', message: 'x' }).kind, 'identity');
  assert.equal(fromNetworkError({ code: 'ERR_SYNCBOX_TOO_LARGE' }).kind, 'protocol');
  assert.equal(reasonOf(fromNetworkError({ code: 'ETIMEDOUT' })), 'ETIMEDOUT');
});

test('an unexpected box at the address is refused; requests run one at a time', async () => {
  const box = new FakeBox();
  const transport = fakeTransport({ '192.168.1.12': box });
  const wrong = new SyncBoxClient({
    host: '192.168.1.12',
    uniqueId: 'C42996000001',
    token: 'token-1',
    transport,
  });
  await assert.rejects(wrong.getState(), { kind: 'identity' });

  let running = 0;
  let most = 0;
  const slow = {
    async request() {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { status: 200, body: '{}', peerId: 'C42996000000' };
    },
  };
  const c = new SyncBoxClient({ host: 'h', token: 't', transport: slow });
  await Promise.all([c.getState(), c.setExecution({ mode: 'video' }), c.getState()]);
  assert.equal(most, 1);
});

test('a registration answer without a token, an empty or non-JSON answer', async () => {
  const answers = [
    { status: 200, body: '{"registrationId":"3"}' },
    { status: 200, body: 'not json' },
  ];
  const t = { request: async () => ({ ...answers.shift(), peerId: 'C42996000000' }) };
  const c = new SyncBoxClient({ host: 'h', token: 't', transport: t });
  await assert.rejects(c.register(), { kind: 'protocol' });
  await assert.rejects(c.getState(), { kind: 'protocol' });
});
