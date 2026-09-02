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
/work — travailler avec un cooldown
/daily — récompense quotidienne
/deposit montant:<montant|all> — déposer à la banque
/withdraw montant:<montant|all> — retirer de la banque
/leaderboard — afficher le classement dans un embed
/steal membre:<membre> — tenter de voler le portefeuille d'un membre

## Jeux

/blackjack mise:<montant>, puis /hit ou /stand
/coinflip mise:<montant> choix:<pile|face>
/dice mise:<montant> choix:<1-6>
/slots mise:<montant>
/roulette mise:<montant> pari:<rouge|noir|0-36>

## Administration

/addmoney membre:<membre> montant:<montant>

La commande /addmoney est réservée aux administrateurs.

## Déploiement Railway ou Bot-Hosting

Commande de démarrage : npm start
Variables nécessaires : DISCORD_TOKEN et GUILD_ID.
Les données sont sauvegardées dans data/economy.json. Pour une économie durable, utiliser un volume persistant ou PostgreSQL.

Ne commite jamais le vrai token Discord.
