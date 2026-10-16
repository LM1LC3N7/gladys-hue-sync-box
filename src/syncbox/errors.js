// -----------------------------------------------------------------------------
// The errors of the Sync Box client, by what they tell the user:
//   auth         the token is missing, invalid or revoked (codes 1-3, HTTP 401)
//   state        "Invalid State" (code 16): no button press yet while
//                registering, or the entertainment area is busy
//   refused      any other error answer of the box ({ code, message })
//   unreachable  no answer (network, timeout, connection reset)
//   certificate  the certificate is not signed by the Sync Box root CA
//   identity     a genuine Sync Box answered, but not the expected one
//   protocol     an answer that is not the Sync Box API (not JSON, too big…)
// -----------------------------------------------------------------------------

export class SyncBoxError extends Error {
  constructor(kind, message, { status, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SyncBoxError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const CERTIFICATE_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
]);

/** A network or TLS error of node:https -> a SyncBoxError. */
export function fromNetworkError(err) {
  if (err instanceof SyncBoxError) {
    return err;
  }
  const code = err?.code;
  if (code === 'ERR_SYNCBOX_IDENTITY') {
    return new SyncBoxError('identity', err.message, { cause: err });
  }
  if (CERTIFICATE_CODES.has(code)) {
    return new SyncBoxError('certificate', `certificate refused (${code})`, { cause: err });
  }
  if (code === 'ERR_SYNCBOX_TOO_LARGE') {
    return new SyncBoxError('protocol', 'answer too large', { cause: err });
  }
  return new SyncBoxError('unreachable', String(code ?? err?.message ?? err).slice(0, 120), {
    cause: err,
  });
}

/** A short reason for the logs and the statuses: never a header, never the token. */
export function reasonOf(err) {
  if (err?.kind === 'refused' || err?.kind === 'state' || err?.kind === 'auth') {
    return err.message;
  }
  return String(err?.message ?? err).slice(0, 160);
}
