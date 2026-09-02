# Hirosaki Game

Bot Discord de jeu et d'économie avec commandes slash.

## Installation

1. Installer Node.js 18.17 ou plus récent.
2. Installer les dépendances avec : `npm install`
3. Ajouter `DISCORD_TOKEN` dans les variables d'environnement du serveur.
4. Ajouter `GUILD_ID` pour enregistrer les commandes immédiatement pendant les tests.
5. Activer Message Content Intent dans le portail développeur Discord.
6. Démarrer avec : `npm start`

## Boutique personnalisable

Les administrateurs peuvent tout gérer directement depuis Discord :

- `/shop-create id nom prix description [stock] [emoji] [categorie] [role]` : créer un article.
- `/shop-edit id [nom] [prix] [description] [stock] [emoji] [categorie] [role] [retirer-role]` : modifier un article.
- `/shop-delete id` : supprimer un article.
- `/shop-list` : afficher la boutique en aperçu admin.
- `/shop-config [titre] [description] [couleur] [pied] [reinitialiser]` : personnaliser son apparence.
- `/shop` : afficher la boutique aux joueurs.
- `/buy item quantité` : acheter un article.
- `/inventory` : voir ses achats.

Le stock vide ou `illimite` signifie illimité. Un rôle associé est automatiquement donné lors de l'achat. La boutique est séparée par catégories et affiche les emojis personnalisés.

## Jeux classiques

- `/craps mise` : 7 ou 11 au premier tir = gain x2 ; 2, 3 ou 12 = perte ; un point donne 3 lancers pour gagner x4, sinon la mise est remboursée.
- `/blackjack mise`, puis `/hit`, `/stand`, `/split` ou `/double`.
- `/coinflip`, `/dice`, `/roulette`, `/slots`, `/rps` et `/higherlower`.

## Économie

`/help`, `/balance`, `/work`, `/daily`, `/deposit`, `/withdraw`, `/leaderboard`, `/steal` et `/addmoney`.

## Données et déploiement

Les données sont sauvegardées dans `data/economy.json`. Pour une économie durable, utiliser un volume persistant ou PostgreSQL. Ne commite jamais le vrai token Discord.