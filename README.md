# Rushcut

Éditeur vidéo desktop (Mac et Windows) assisté par IA. Claude monte la vidéo à partir du transcript. Tu commentes au timecode, tu dessines sur l'image, et Claude produit la V2, puis la V3.

![Éditeur](docs/editeur.png)

## Installer et lancer

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run dev
```

Au premier lancement, la fenêtre Réglages s'ouvre. Colle ta clé **ElevenLabs**, puis choisis comment joindre Claude :

- **Mon abonnement Claude** (Pro ou Max) : Rushcut passe par [Claude Code](https://claude.com/claude-code) installé sur ton ordinateur. Installe-le, lance `claude auth login` une fois dans un terminal, puis clique sur **Vérifier**. Pas de clé API : l'usage compte dans les limites de ton abonnement. Si `claude` n'est pas trouvé tout seul, indique son chemin.
- **Clé API** : colle ta clé **Claude (Anthropic)**.

Les clés sont chiffrées avec le trousseau du système.

## Créer l'installeur

L'installeur se construit sur la machine visée, car ffmpeg est téléchargé pour le système qui lance `npm install`.

Sur un Mac, on obtient un `.dmg` dans `dist/` :

```bash
npm run dist:mac
```

Sur un PC Windows, on obtient un installeur `.exe` dans `dist/` :

```bash
npm run dist:win
```

L'app n'est pas signée. Au premier lancement :
- sur Mac : clic droit sur l'app, puis **Ouvrir** ;
- sur Windows : **Informations complémentaires**, puis **Exécuter quand même**.

## Comment ça marche

1. **Import** (une seule fois par rush) : ffmpeg crée un proxy 540p avec l'encodeur matériel (VideoToolbox, NVENC, QuickSync ou AMF). Il calcule aussi la forme d'onde, les silences et une planche de vignettes.
2. **Transcription** : ElevenLabs Scribe renvoie chaque mot avec son timecode. Rien ne tourne sur ton CPU.
3. **V1** : Claude lit le transcript et écrit un fichier de montage JSON (`edl/V1.json`). Ce fichier contient les coupes, les séquences, les zooms, le motion design et les sous-titres. Aucune vidéo n'est rendue à ce stade. Chaque coupe est ensuite recalée sur une frontière de mot : aucune ne tombe au milieu d'un mot.
4. **Revue** : la lecture saute les passages coupés. Le motion design s'affiche par-dessus en HTML, sans rendu. Tu poses tes remarques :
   - **P** pour un pin au timecode ;
   - **D** pour dessiner (crayon, cercle, flèche, rectangle, 4 couleurs), puis **Joindre ↵**.
5. **V2, V3…** : Claude reçoit les commentaires ouverts et l'image dessinée. Il ne réécrit pas le montage : il renvoie une liste de modifications (couper, restaurer, ajouter ou retirer un graphisme, un zoom…), appliquées à la version précédente. Ce qui n'est pas commenté ne bouge pas. Les commentaires traités passent en « corrigé en V2 ».
6. **Export** : le rendu part du rush original.
   - Chaque segment est mis en cache : une V3 qui touche deux coupes ne ré-encode que ces deux coupes.
   - Le motion design est capturé seulement aux instants où il change (170 images pour 15 s au lieu de 450).
   - Format **Vertical 9:16** (Reels, TikTok, Shorts) : le rush est recadré, un curseur règle la position du cadre. Les graphismes et sous-titres se placent hors des zones couvertes par l'interface des réseaux.
   - Option **.srt** : un fichier de sous-titres, par phrases, à côté de la vidéo.

### Onboarding avant la V1

À l'ouverture d'un nouveau projet, Rushcut pose six questions avant de générer quoi que ce soit : le modèle de vidéo (Reel, tutoriel, extrait de podcast, pub produit, interview, vlog, ou copie d'une vidéo d'exemple), l'objectif et le public, le ton, le rythme et les zooms, le design system et le style des sous-titres, puis les images d'illustration. Les réponses forment un brief que Claude lit avant de monter la V1. On peut passer l'onboarding (Échap) et y revenir avec **Préparer la V1** ou depuis l'onglet **Style**.

### Images d'illustration

Ajoute des images (logo, produit, photos, captures) dans l'onboarding ou dans l'onglet **Style**. Claude les place au moment où tu en parles, soit en carte à côté de toi, soit en plein écran avec un zoom lent. Tu peux aussi en poser une toi-même à la tête de lecture (**Carte** ou **Plein**). Les images sont copiées dans `assets/` du projet.

### Style en direct

L'onglet **Style** change le design system et le style des sous-titres (karaoké, pop, bandeau, minimal) sans régénérer : l'aperçu et l'export suivent.

### Copier le montage d'une vidéo d'exemple

Dans **Générer V1**, choisis une vidéo dont tu aimes le montage. Rushcut y détecte les coupes et Claude examine les images clés. Il en tire une recette (rythme, zooms, sous-titres, graphismes, structure), que Claude applique ensuite à ton rush.

### Design systems

Quatre styles sont fournis. **+ Nouveau** crée un design system à partir d'une capture d'écran, d'un deck ou d'un site : Claude en extrait les couleurs, la police et les arrondis.

## Raccourcis

| Touche | Action |
|---|---|
| Espace | Lecture / pause |
| ← → (Maj : 1 s) | Image par image |
| P | Pin au timecode |
| D | Dessiner sur l'image |
| C | Couper à la tête de lecture |
| Z | Ajouter un zoom à la tête de lecture |
| M | Ajouter un chapitre à la tête de lecture |
| Suppr | Supprimer le plan, le graphisme, le zoom, le chapitre ou les mots sélectionnés. Sur une zone hachurée, restaure le passage |
| H | Lecture montée ou lecture brute |
| ⌘/Ctrl+Z, ⇧⌘Z | Annuler, rétablir (montage et corrections du transcript) |
| ⌘/Ctrl+F | Rechercher et remplacer un mot du transcript |
| ⌘/Ctrl + molette | Zoom de la timeline |

Dans le transcript, fais glisser la souris sur des mots puis appuie sur **Suppr** : ils sont coupés de la vidéo. Refais la même chose sur des mots barrés pour les restaurer.

Pour corriger une erreur de transcription, double-clique sur le mot. **Entrée** enregistre, **Échap** annule, **Tab** passe au mot suivant. Si tu tapes plusieurs mots, ils se partagent la durée du mot d'origine. Si tu vides le champ, le mot disparaît du transcript, mais l'audio n'est pas coupé. Pour un nom mal entendu partout, utilise la recherche en haut du transcript (**⌘/Ctrl+F**) puis **Tout remplacer**. Les sous-titres, le `.srt` et Claude utilisent le texte corrigé.

Sur la timeline :
- Glisse le bord d'un plan pour le raccourcir ou le rallonger. Le lecteur montre l'image du bord pendant le geste. Entre deux plans collés (après **C**), le point de montage se déplace sans rien couper.
- Glisse un graphisme ou un zoom pour le déplacer, et ses bords pour changer sa durée. Glisse un chapitre pour le déplacer. Un clic ouvre son panneau : texte, force du zoom, titre du chapitre.
- Les bords s'aimantent à la tête de lecture, aux autres coupes et aux mots. Maintiens **Alt** pour placer librement.

## Fichiers d'un projet

Les projets sont dans `Documents/Rushcut/<projet>/` :

| Fichier | Contenu |
|---|---|
| `project.json` | réglages, versions |
| `edl/V*.json` | un montage par version |
| `words.json` | transcript, avec tes corrections |
| `comments.json`, `comments/*.jpg` | commentaires et images annotées |
| `assets/` | images d'illustration |
| `proxy.mp4`, `sprite.jpg`, `peaks.bin` | médias légers pour l'édition |
| `cache/`, `exports/` | segments rendus, MP4 finaux |

Le rush original n'est jamais copié ni modifié.

## Pas encore fait

- Musique, effets sonores et voix ElevenLabs.
- Recadrage 9:16 qui suit le visage (MediaPipe).
- Plusieurs rushes dans un même projet.
- Images d'illustration générées.
