# Philips Hue Sync Box

**Connecteur non officiel, sans lien avec Signify (Philips Hue).** Il amène
la **Philips Hue Play HDMI Sync Box** (le modèle d'origine, 4K et 8K) dans
Gladys, par l'API locale officielle du boîtier, sur votre réseau : sans
compte, sans cloud.

**Testeurs bienvenus** : cette première version a été écrite sans boîtier
sous la main, à partir de la documentation de l'API de la Hue Sync Box, de la
bibliothèque de l'intégration Home Assistant et du plugin Homebridge. Elle a
été testée contre un boîtier simulé. Dites sur le forum ce qui marche avec le
vôtre, et ce qui ne marche pas.

## Ce que vous obtenez

| Élément                     | Contenu                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par **boîtier** | marche (allumé / veille), synchronisation des lumières (oui / non), mode (veille, passthrough, vidéo, musique, jeu), intensité de chaque mode, luminosité, entrée HDMI, zone de divertissement |
| Déclencheurs de scène       | **le mode a changé** (la synchro a démarré ou s'est arrêtée, autre mode, veille), **l'entrée HDMI a changé**                                                                                   |
| Actions de scène            | **lancer la synchro des lumières** (mode, intensité, entrée, luminosité, zone), **arrêter la synchro des lumières**, **changer d'entrée HDMI**, **lire l'état**                                |
| Boutons de la configuration | **Enregistrer une Sync Box**, **Tester les boîtiers**                                                                                                                                          |

Le boîtier ne sait pas prévenir Gladys d'un changement : Gladys lit son état
toutes les 5 secondes (l'**intervalle de rafraîchissement** de la
configuration, de 2 à 60 secondes) et juste après chaque commande, et
n'envoie à Gladys que les valeurs qui ont changé. Un changement fait dans
l'application Hue Sync, à la télécommande de la TV ou par le boîtier
lui-même (une console qui s'allume) apparaît dans ce délai.

## Mise en route

1. Installez l'intégration et ouvrez son onglet **Configuration**.
2. Cliquez sur **Enregistrer une Sync Box**, puis, dans la minute,
   **maintenez le bouton à l'avant du boîtier** environ 3 secondes, jusqu'à
   ce que son voyant clignote en vert, et relâchez-le. La réponse sous le
   bouton donne le boîtier enregistré. Le boîtier affiche « Gladys
   Assistant » dans la liste des applications de l'application Hue Sync.
3. Ouvrez **Découverte** et ajoutez le boîtier.

Le boîtier doit déjà être configuré dans l'application Hue Sync (pont Hue et
zones de divertissement). Il est trouvé sur le réseau par mDNS
(`_huesync._tcp`, comme le trouve l'application Hue Sync). Introuvable
(multicast bloqué, autre réseau) ? Saisissez son adresse IP dans le champ
**Adresse** du bouton, ou dans **Adresses des boîtiers** de la configuration
(l'application Hue Sync l'affiche dans Paramètres → Appareil). Donnez au
boîtier une adresse fixe dans votre box ; si son adresse change quand même,
Gladys le cherche à nouveau par mDNS.

## L'appareil

- **Marche** : éteindre met le boîtier en veille ; allumer le réveille en
  passthrough (l'image passe, les lumières restent comme elles sont).
  L'allumer pendant qu'il synchronise ne fait rien.
- **Synchronisation des lumières** : oui lance la synchro dans le dernier
  mode utilisé ; non revient en passthrough.
- **Mode** : veille, passthrough, vidéo, musique ou jeu.
- **Intensité vidéo / musique / jeu** : subtile, modérée, élevée ou intense,
  pour chaque mode, même quand un autre mode est actif.
- **Luminosité** : de 0 à 100 % ; **50 % est la luminosité de la source**,
  en dessous les lumières baissent, au-dessus elles sont renforcées
  (l'échelle du boîtier va de 0 à 200).
- **Entrée HDMI** : entrée 1 à 4, affichée avec les noms donnés dans
  l'application Hue Sync (« Gaming (HDMI 2) »).
- **Zone de divertissement** : les zones de divertissement Hue du pont
  associé au boîtier.

Les noms des entrées et des zones suivent l'application Hue Sync quelques
secondes après que vous les changez.

## Scènes

- **Le mode a changé** : un boîtier (ou aucun pour tous), et en option le
  nouveau mode. Variables : le nom du boîtier, le nouveau et l'ancien mode,
  si les lumières synchronisent, le nom de l'entrée HDMI. Par exemple :
  « quand la synchro démarre, fermer les volets ».
- **L'entrée HDMI a changé** : en option la nouvelle entrée (1-4).
  Variables : le nom du boîtier, la nouvelle et l'ancienne entrée (numéro et
  nom), le mode. Par exemple : « quand l'entrée de la console est
  choisie, éteindre le plafonnier ».
- **Lancer la synchro des lumières** : le mode (vide : le dernier), et en
  option l'intensité, l'entrée HDMI, la luminosité (%) et le nom d'une zone
  de divertissement. Un boîtier en veille est allumé. Sorties : le mode,
  l'entrée et son nom.
- **Arrêter la synchro des lumières** : puis rester allumé (passthrough) ou
  se mettre en veille.
- **Changer d'entrée HDMI** : entrée 1 à 4. Sorties : l'entrée et son nom.
- **Lire l'état** donne `online`, `power`, `syncing`, `mode`, `input`,
  `input_name`, `brightness`, `intensity`, `area` pour une condition ou un
  message. Les actions suivantes de la scène les trouvent dans leur liste de
  variables.

Les changements faits depuis Gladys (une commande, une scène) ne
déclenchent aucun déclencheur de l'intégration pendant 15 secondes : une
scène ne peut jamais boucler à travers le boîtier. L'action générique
**Contrôler un appareil** pilote aussi la marche, la synchro et la
luminosité.

## Bon à savoir

- Quand une autre application diffuse vers la zone de divertissement
  (l'application Hue Sync sur un ordinateur, un autre boîtier), le boîtier
  refuse de lancer la synchro ; Gladys arrête alors cette diffusion et
  relance, comme le fait Home Assistant.
- Gladys envoie une requête à la fois à un boîtier. Un boîtier qui ne répond
  plus est affiché injoignable après trois lectures en échec, et suivi à
  nouveau dès qu'il répond.
- Chaque enregistrement ajoute une entrée dans la liste des applications du
  boîtier ; vous pouvez supprimer les anciennes dans l'application Hue Sync.

## Sécurité

Le boîtier répond en HTTPS avec un certificat émis par l'autorité de la
Philips Hue Sync Box. L'intégration fait confiance **à cette autorité
seulement**, pour ces requêtes seulement, et vérifie que le certificat nomme
**le boîtier enregistré** (son identifiant unique, sur son étiquette) : un
autre appareil, ou un autre boîtier à la même adresse, est refusé. Le jeton
d'accès donné par le boîtier à l'enregistrement est gardé dans la
configuration de l'intégration, jamais affiché à l'écran ni écrit dans les
journaux.

## Dépannage

- **« Aucun appui vu »** : cliquez à nouveau sur **Enregistrer une Sync
  Box** et maintenez le bouton jusqu'à ce que le voyant clignote en vert (un
  appui bref ne fait rien). Si la synchro des lumières tourne, arrêtez-la
  d'abord.
- **« Aucune Sync Box trouvée »** : saisissez l'adresse du boîtier (voir
  plus haut). Vérifiez que Gladys et le boîtier sont sur le même réseau.
- **« Enregistrement refusé »** : l'enregistrement a été supprimé dans
  l'application Hue Sync ou le boîtier a été réinitialisé ; enregistrez-le à
  nouveau.
- **Injoignable** : le boîtier est débranché, hors de portée du Wi-Fi, ou a
  une nouvelle adresse (Gladys le cherche à nouveau par mDNS toutes les 5
  minutes ; une nouvelle recherche dans Découverte le fait tout de suite).
- **« Entertainment area is busy »** : le pont Hue n'est pas connecté au
  boîtier, ou une autre application tient la zone ; vérifiez dans
  l'application Hue Sync.
- Journaux : le niveau de journalisation de l'intégration se règle avec la
  variable `LOG_LEVEL`.

## Confidentialité

L'intégration ne parle qu'à vos Sync Box, sur votre réseau local, sans
aucun compte.
