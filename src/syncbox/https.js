// -----------------------------------------------------------------------------
// The only network access of the integration: HTTPS requests to the Sync
// Boxes, on node:https.
//
// Trust, scoped to these requests only (the process-wide trust store is
// never touched, and no request ever skips the verification):
//   - the chain must lead to the Sync Box root CA ("root-hsb", published by
//     Philips Hue, src/syncbox/certificate.js) and to nothing else: a public
//     CA or a self-signed certificate is refused;
//   - the common name of the box certificate is its unique id. When the id is
//     known (mDNS `uniqueid`, or the registration), the certificate must carry
//     it, so another box, genuine or not, cannot stand in for it. On the first
//     contact with a typed address, any id of the right shape is accepted and
//     returned (`peerId`), then kept with the registration: trust on first
//     use, anchored to the Sync Box CA.
// The SNI is the expected id, as aiohuesyncbox (Home Assistant) sends it.
//
// One keep-alive connection per box (the box handles few connections, like
// aiohuesyncbox's `limit_per_host=1`), a deadline per request, a size cap on
// the answer, no redirect.
// -----------------------------------------------------------------------------

import https from 'node:https';
import { LIMITS, TIMINGS } from '../constants.js';
import { HSB_ROOT_CA } from './certificate.js';

export const UNIQUE_ID = /^[0-9A-F]{12}$/;

/** The unique id of a box certificate (its common name), or undefined. */
export function certificateId(cert) {
  const cn = cert?.subject?.CN;
  const value = Array.isArray(cn) ? cn[0] : cn;
  const id = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return UNIQUE_ID.test(id) ? id : undefined;
}

/** checkServerIdentity for node:tls: the certificate must name the expected box. */
export function identityCheck(expectedId) {
  return (_hostname, cert) => {
    const id = certificateId(cert);
    if (!id) {
      return Object.assign(new Error('the certificate does not name a Sync Box'), {
        code: 'ERR_SYNCBOX_IDENTITY',
      });
    }
    if (expectedId && id !== expectedId) {
      return Object.assign(new Error(`another Sync Box answered (${id}, not ${expectedId})`), {
        code: 'ERR_SYNCBOX_IDENTITY',
      });
    }
    return undefined;
  };
}

/** A host as it goes in a URL: an IPv6 address between brackets. */
export const urlHost = (host) => (host.includes(':') ? `[${host}]` : host);

/**
 * @param {object} [options]
 * @param {string|string[]} [options.ca] trusted CA (the Sync Box root CA;
 *   the tests and the e2e pass their own test CA)
 * @param {number} [options.timeoutMs]
 * @returns {{ request: Function, close: Function }}
 */
export function createHttpsTransport({
  ca = HSB_ROOT_CA,
  timeoutMs = TIMINGS.requestTimeout,
} = {}) {
  // An idle connection is closed after 20 s (the agent destroys a free socket
  // on its timeout): a box polled every 5 s keeps one, a box left alone none.
  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 1,
    maxFreeSockets: 1,
    timeout: 20_000,
  });

  function once({ host, port, path, method, headers, body, expectedId }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn(value);
        }
      };
      const req = https.request(
        {
          host,
          port,
          path,
          method,
          headers,
          agent,
          ca,
          rejectUnauthorized: true,
          ...(expectedId ? { servername: expectedId } : {}),
          checkServerIdentity: identityCheck(expectedId),
        },
        (res) => {
          const peerId = certificateId(res.socket?.getPeerCertificate?.());
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > LIMITS.responseBytes) {
              req.destroy(
                Object.assign(new Error('answer too large'), { code: 'ERR_SYNCBOX_TOO_LARGE' }),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            finish(resolve, {
              status: res.statusCode,
              contentType: String(res.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks).toString('utf8'),
              peerId,
            }),
          );
          res.on('error', (err) => finish(reject, err));
        },
      );
      const timer = setTimeout(
        () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
        timeoutMs,
      );
      req.on('error', (err) => finish(reject, Object.assign(err, { reused: req.reusedSocket })));
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }

  return {
    /**
     * One request. A kept-alive connection the box closed meanwhile fails at
     * once with ECONNRESET: the request is sent again once, on a new one.
     * @returns {Promise<{ status, contentType, body, peerId }>}
     */
    async request(options) {
      try {
        return await once(options);
      } catch (err) {
        if (err?.reused && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
          return once(options);
        }
        throw err;
      }
    },
    close() {
      agent.destroy();
    },
  };
}
