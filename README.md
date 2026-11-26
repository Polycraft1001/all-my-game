# 🎮 All My Game

Tous mes jeux web réunis sur un seul site.

## Jouer
Active **GitHub Pages** (Settings → Pages → Branch `main` / root) puis va sur https://polycraft1001.github.io/all-my-game/

> GTA7 utilise des modules JavaScript : il doit être ouvert via un serveur (GitHub Pages, ou `python -m http.server`), pas en double-cliquant sur le fichier.

## Jeux inclus
| Jeu | Catégorie |
|---|---|
| Forest Rally Drift 3D (👥 multijoueur en ligne par code, via [PeerJS](https://peerjs.com/)) | Course |
| GTA7 (👥 multijoueur en ligne par code, via [PeerJS](https://peerjs.com/)) | Monde ouvert |
| La Chasse des Paysans 3D | Action |

## 🧮 Onglet NumWorks — crédits
- **STI2D-OS** (`numworks/sti2d-os/`) : créé par **Yamii** (Discord `cjnw`) & **Derim** (Discord `irationnel`). Publié ici avec leur autorisation, tous droits réservés à leurs auteurs. Serveur officiel : **https://discord.gg/sti2d**. Projet d'origine : https://github.com/osyamiii/STI2D-OS-V1
- **NumPlay** (`numworks/numplay/`) : créé par **Mason363**, sous licence GNU GPL v3 (voir `numworks/numplay/LICENSE`). Projet d'origine : https://github.com/Mason363/NumPlay

## Ajouter un jeu
1. Mets le fichier `.html` (ou un dossier avec `index.html`) dans `games/` (sur GitHub : *Add file → Upload files*).
2. C'est tout : le jeu apparaît tout seul sur le site (catégorie « Autres », jusqu'à 10 min de cache).
3. Optionnel : ajoute une ligne dans le tableau `GAMES` de `index.html` pour lui donner un titre, une icône, une couleur, une catégorie et une description.

> La détection automatique lit le dossier `games/` via l'API GitHub. En local (sans GitHub), seuls les jeux listés dans `GAMES` apparaissent.
