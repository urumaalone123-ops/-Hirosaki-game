# Hirosaki Game

Bot Discord de jeu et d'économie avec commandes slash.
Les commandes sont séparées du bot Hirosaki de gestion et apparaissent dans le menu Discord.

## Installation

1. Installer Node.js 18.17 ou plus récent.
2. Installer les dépendances avec : npm install
3. Ajouter DISCORD_TOKEN dans les variables d'environnement du serveur.
4. Ajouter GUILD_ID avec l'identifiant du serveur pour enregistrer les commandes immédiatement pendant les tests.
5. Activer Message Content Intent dans le portail développeur Discord.
6. Démarrer avec : npm start

## Commandes joueurs

/help — afficher l'aide dans un embed
/balance — voir le portefeuille et la banque
/work — travailler avec un cooldown de 45 secondes
/daily — récompense quotidienne avec cooldown de 24 heures
/deposit montant:<montant|all> — déposer à la banque
/withdraw montant:<montant|all> — retirer de la banque
/leaderboard — afficher le classement dans un embed
/steal membre:<membre> — tenter de voler le portefeuille d'un membre
/shop — afficher la boutique
/buy item:<id> quantite:<nombre> — acheter un article
/inventory — voir ses achats

## Jeux

/blackjack mise:<montant>, puis /hit ou /stand
/coinflip mise:<montant> choix:<pile|face>
/dice mise:<montant> choix:<1-6>
/slots mise:<montant>
/roulette mise:<montant> pari:<rouge|noir|0-36>
/rps mise:<montant> choix:<pierre|papier|ciseaux>
/higherlower mise:<montant> choix:<haut|bas>

## Gestion de la boutique

Ces commandes sont réservées aux administrateurs ou aux membres ayant la permission Gérer le serveur :
/shop-create id:<id> nom:<nom> prix:<prix> description:<description> [stock] [role]
/shop-edit id:<id> [nom] [prix] [description] [stock] [role]
/shop-delete id:<id>
/shop-list

Un stock vide ou la valeur illimite signifie que l'article est disponible sans limite. Un rôle associé est automatiquement donné lors de l'achat.

## Administration

/addmoney membre:<membre> montant:<montant>

## Données et déploiement

Commande de démarrage : npm start
Les données sont sauvegardées dans data/economy.json. Pour une économie durable, utiliser un volume persistant ou PostgreSQL.
Ne commite jamais le vrai token Discord.
