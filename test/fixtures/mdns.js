// Raw mDNS scan results as the core returns them for `_huesync._tcp` (TXT
// records as in Home Assistant's huesyncbox zeroconf tests).
export const MDNS_RESULTS = [
  {
    name: 'HueSyncBox-C42996000000._huesync._tcp.local',
    host: 'C42996000000.local',
    addresses: ['fe80::1', '192.168.1.12'],
    port: 443,
    txt: ['uniqueid=C42996000000', 'path=/api', 'name=My Sync Box', 'devicetype=HSB001'],
  },
  {
    // the same box seen twice (two interfaces)
    name: 'HueSyncBox-C42996000000._huesync._tcp.local.',
    addresses: ['192.168.1.12'],
    port: 443,
    txt: ['uniqueid=C42996000000'],
  },
  {
    name: 'Bedroom._huesync._tcp.local',
    addresses: ['192.168.1.40'],
    port: 443,
    txt: ['UNIQUEID=c42996000999', 'path=/../evil?x', 'name=Bedroom', 'devicetype=HSB002'],
  },
  {
    // another service, an id of the wrong shape, no address
    name: 'Hue Bridge._hue._tcp.local',
    addresses: ['192.168.1.8'],
    port: 443,
    txt: ['bridgeid=001788fffe000000'],
  },
  { name: 'X._huesync._tcp.local', addresses: ['192.168.1.50'], txt: ['uniqueid=nothex'] },
  { name: 'Y._huesync._tcp.local', addresses: [], txt: ['uniqueid=C42996000123'] },
];
