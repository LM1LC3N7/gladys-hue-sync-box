#!/bin/sh
# Test certificates of the fake Sync Boxes (tests and e2e only, never used by
# the integration itself, which trusts the Philips Hue "root-hsb" CA only).
# Generated once and committed; regenerate with:
#   docker run --rm -v "$PWD/test/fixtures/tls:/tls" -w /tls alpine:3 sh -c 'apk add -q openssl && sh make.sh'
#
#   ca.pem / ca.key            "test-root-hsb", stands for the Sync Box root CA
#   box.pem / box.key          a box C42996000000, issued by that CA (CN = unique id)
#   other.pem / other.key      another box, C42996000001, issued by that CA
#   selfsigned.pem / .key      CN C42996000000, self-signed (an impostor)
set -eu
DAYS=36500
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -days "$DAYS" -subj '/C=NL/O=Gladys tests/CN=test-root-hsb' \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -out ca.pem
leaf() {
  openssl ecparam -name prime256v1 -genkey -noout -out "$1.key"
  openssl req -new -key "$1.key" -subj "/C=NL/O=Gladys tests/CN=$2" -out "$1.csr"
  printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyAgreement\nextendedKeyUsage=serverAuth\n' >"$1.ext"
  openssl x509 -req -in "$1.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -days "$DAYS" \
    -extfile "$1.ext" -out "$1.pem"
  rm -f "$1.csr" "$1.ext"
}
leaf box C42996000000
leaf other C42996000001
openssl ecparam -name prime256v1 -genkey -noout -out selfsigned.key
openssl req -x509 -new -key selfsigned.key -days "$DAYS" -subj '/C=NL/O=Gladys tests/CN=C42996000000' \
  -out selfsigned.pem
rm -f ca.srl
