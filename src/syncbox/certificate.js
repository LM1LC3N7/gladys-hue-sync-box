// -----------------------------------------------------------------------------
// The root CA that signs the HTTPS certificate of every Hue Sync Box
// ("root-hsb", Philips Hue, valid until 9999), published by Philips Hue with
// the HDMI Sync Box API documentation:
//   https://developers.meethue.com/wp-content/uploads/2020/01/hsb_cacert.pem_.txt
// The same certificate ships in aiohuesyncbox (hsb_cacert.py, Apache-2.0) and
// homebridge-philips-hue-sync-box (hsb-ca-cert.ts, MIT).
//
// Each box presents a leaf certificate issued by this CA whose common name is
// its unique id (12 hex characters, also its mDNS `uniqueid` and the
// `device.uniqueId` of the API): src/syncbox/https.js trusts this CA only, for
// these requests only, and checks that common name.
// -----------------------------------------------------------------------------

export const HSB_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIBwDCCAWagAwIBAgIBATAKBggqhkjOPQQDAjA2MQswCQYDVQQGEwJOTDEUMBIG
A1UECgwLUGhpbGlwcyBIdWUxETAPBgNVBAMMCHJvb3QtaHNiMCAXDTE3MDEwMTAw
MDAwMFoYDzk5OTkxMjMxMjM1OTU5WjA2MQswCQYDVQQGEwJOTDEUMBIGA1UECgwL
UGhpbGlwcyBIdWUxETAPBgNVBAMMCHJvb3QtaHNiMFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAEr9FgOxnsonsrnUZr3C4ggST7YCR9wISvDuwlNdZcAz4HiVCNmAAP
tAnAFDG0U19Rmc4MfRYBMO8GrOHrOkZ7sKNjMGEwHQYDVR0OBBYEFCK+VIWZqp++
DHqmGLWEZHYdH9v7MB8GA1UdIwQYMBaAFCK+VIWZqp++DHqmGLWEZHYdH9v7MA8G
A1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMCA0gAMEUC
IAFDI0Q4IOPxV7cY4wSVOJAn4y5AdZwrItJ1XuNpmCltAiEA5c6wcu6qmF596uyA
r7xLnr3/F5zJxrE3AyLD4t+5oKs=
-----END CERTIFICATE-----
`;
