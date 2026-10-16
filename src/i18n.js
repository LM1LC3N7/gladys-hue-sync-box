// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, buttons, errors).
// Errors thrown to Gladys are English (one language per message, like the
// core's); the statuses and button answers are { en, fr }.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });
const join = (parts) => both(parts.map((p) => p.en).join(' '), parts.map((p) => p.fr).join(' '));
const plural = (n, one, many) => (n === 1 ? one : many);

export const T = {
  join,
  notRegistered: both(
    'No Sync Box registered yet: click "Register a Sync Box", then hold the button of the box until its light blinks green.',
    "Aucune Sync Box enregistrée : cliquez sur « Enregistrer une Sync Box », puis maintenez le bouton du boîtier jusqu'à ce que son voyant clignote en vert.",
  ),
  notCreated: (n) =>
    both(
      `${n} Sync Box ${plural(n, 'is', 'es are')} registered: open Discovery to add ${plural(n, 'it', 'them')}.`,
      `${n} Sync Box ${plural(n, 'enregistrée', 'enregistrées')} : ouvrez Découverte pour ${plural(n, "l'ajouter", 'les ajouter')}.`,
    ),
  ok: (n) =>
    both(
      `${n} Sync Box ${plural(n, 'answers', 'es answer')} on the local network.`,
      `${n} Sync Box ${plural(n, 'répond', 'répondent')} sur le réseau local.`,
    ),
  unreachable: (names) =>
    both(
      `Not answering: ${names.join(', ')} (unplugged, or a new address: open Discovery).`,
      `Ne répond pas : ${names.join(', ')} (débranchée, ou nouvelle adresse : ouvrez Découverte).`,
    ),
  refused: (names) =>
    both(
      `Registration refused by ${names.join(', ')}: click "Register a Sync Box" again.`,
      `Enregistrement refusé par ${names.join(', ')} : cliquez à nouveau sur « Enregistrer une Sync Box ».`,
    ),
  missing: (names) =>
    both(
      `Not registered: ${names.join(', ')}: click "Register a Sync Box".`,
      `Non enregistrée : ${names.join(', ')} : cliquez sur « Enregistrer une Sync Box ».`,
    ),
  invalidHosts: (positions) =>
    both(
      `Ignored address(es) in the configuration, position ${positions.join(', ')}: type an IP or a host name, with an optional :port.`,
      `Adresse(s) ignorée(s) dans la configuration, position ${positions.join(', ')} : saisissez une IP ou un nom d'hôte, avec un :port facultatif.`,
    ),
  register: {
    badAddress: both(
      'This address is not valid: type an IP address or a host name.',
      "Cette adresse n'est pas valide : saisissez une adresse IP ou un nom d'hôte.",
    ),
    none: both(
      'No Sync Box found. Check that it is powered and on the same network, or type its IP address (Hue Sync app → Settings → Device) in the "Address" field of this button or in the configuration.',
      "Aucune Sync Box trouvée. Vérifiez qu'elle est alimentée et sur le même réseau, ou saisissez son adresse IP (application Hue Sync → Paramètres → Appareil) dans le champ « Adresse » de ce bouton ou dans la configuration.",
    ),
    done: (labels) =>
      both(
        `Registered: ${labels.join(', ')}. Open Discovery to add ${plural(labels.length, 'it', 'them')} to Gladys.`,
        `Enregistrée(s) : ${labels.join(', ')}. Ouvrez Découverte pour ${plural(labels.length, "l'ajouter", 'les ajouter')} à Gladys.`,
      ),
    already: (labels) =>
      both(
        `Already registered: ${labels.join(', ')}.`,
        `Déjà enregistrée(s) : ${labels.join(', ')}.`,
      ),
    noPress: (labels) =>
      both(
        `No button press seen on ${labels.join(', ')}. Click the button again, then hold the button on the front of the box for about 3 seconds, until its light blinks green.`,
        `Aucun appui vu sur ${labels.join(', ')}. Cliquez à nouveau, puis maintenez le bouton à l'avant du boîtier environ 3 secondes, jusqu'à ce que son voyant clignote en vert.`,
      ),
    failed: (label, reason) => both(`${label}: ${reason}.`, `${label} : ${reason}.`),
  },
  test: {
    none: both(
      'No Sync Box registered: click "Register a Sync Box" first.',
      "Aucune Sync Box enregistrée : cliquez d'abord sur « Enregistrer une Sync Box ».",
    ),
    ok: (label, r) =>
      both(
        `${label}: ${r.model}, firmware ${r.firmware || '?'} (API ${r.apiLevel ?? '?'}), mode ${r.mode ?? '?'}, input ${r.inputLabel || '?'}.`,
        `${label} : ${r.model}, micrologiciel ${r.firmware || '?'} (API ${r.apiLevel ?? '?'}), mode ${r.mode ?? '?'}, entrée ${r.inputLabel || '?'}.`,
      ),
    failed: (label, reason) =>
      both(`${label}: no answer (${reason}).`, `${label} : pas de réponse (${reason}).`),
    refused: (label) =>
      both(
        `${label}: the box refused the token, register it again.`,
        `${label} : le boîtier refuse le jeton, enregistrez-le à nouveau.`,
      ),
  },
  errors: {
    unknownBox: 'Unknown Sync Box: pick a Sync Box device of this integration',
    notRegistered: (name) => `${name} is not registered: click "Register a Sync Box"`,
    refusedToken: (name) => `${name} refused the token: click "Register a Sync Box" again`,
    unreachable: (name, reason) => `${name} does not answer (${reason}): is it powered?`,
    refused: (name, reason) => `${name} refused the command (${reason})`,
    busy: (name) =>
      `${name}: the entertainment area is busy (another application streams to it, or the Hue bridge is not connected)`,
    badValue: (key, value) => `Invalid value "${value}" for ${key}`,
    noHdmi: (name) => `${name} has no HDMI input`,
    unknownInput: (query) => `Unknown input "${query}": use 1 to 4, or the name of an input`,
    unknownArea: (query, names) =>
      `Unknown entertainment area "${query}"; areas: ${names.join(', ') || 'none'}`,
  },
};
