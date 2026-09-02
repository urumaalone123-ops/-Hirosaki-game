const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionsBitField,
  ActivityType
} = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = "+";
const DATA_FILE = path.resolve(process.env.DATA_FILE || "data/economy.json");
const MESSAGE_COOLDOWN = 60 * 1000;
const WORK_COOLDOWN = 45 * 1000;
const STEAL_COOLDOWN = 10 * 60 * 1000;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;

if (!TOKEN) {
  console.error("DISCORD_TOKEN est absent. Ajoute-le dans les secrets ou dans .env.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function makeDatabase() {
  return { version: 1, guilds: {} };
}

function loadDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return makeDatabase();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!parsed.guilds) parsed.guilds = {};
    return parsed;
  } catch (error) {
    console.error("Impossible de lire la base JSON, nouvelle base utilisée :", error.message);
    return makeDatabase();
  }
}

const db = loadDatabase();
let saveTimer;
function saveDatabase() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tempFile = DATA_FILE + ".tmp";
      fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
      fs.renameSync(tempFile, DATA_FILE);
    } catch (error) {
      console.error("Erreur de sauvegarde :", error.message);
    }
  }, 250);
}

function guildData(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = { users: {}, blackjack: {} };
  if (!db.guilds[guildId].users) db.guilds[guildId].users = {};
  if (!db.guilds[guildId].blackjack) db.guilds[guildId].blackjack = {};
  return db.guilds[guildId];
}

function userData(guildId, userId) {
  const guild = guildData(guildId);
  if (!guild.users[userId]) {
    guild.users[userId] = { wallet: 100, bank: 0, lastDaily: 0, lastWork: 0, lastSteal: 0 };
  }
  const user = guild.users[userId];
  user.wallet = Number.isFinite(user.wallet) ? Math.max(0, Math.floor(user.wallet)) : 0;
  user.bank = Number.isFinite(user.bank) ? Math.max(0, Math.floor(user.bank)) : 0;
  return user;
}

function money(value) {
  return Math.floor(value).toLocaleString("fr-FR") + " coins";
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function parseAmount(value, available) {
  if (!value) return null;
  if (String(value).toLowerCase() === "all") return Math.floor(available);
  const normalized = String(value).replace(/[, ]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Math.floor(Number(normalized));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function remaining(until) {
  const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  if (seconds >= 3600) return Math.ceil(seconds / 3600) + " h";
  if (seconds >= 60) return Math.ceil(seconds / 60) + " min";
  return seconds + " s";
}

function choice(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function memberMention(message, index) {
  const member = message.mentions.members.first();
  if (member) return member;
  const raw = message.content.split(/\s+/)[index];
  if (!raw || !/^\d{15,25}$/.test(raw)) return null;
  return message.guild.members.cache.get(raw) || null;
}

function isAdmin(message) {
  return message.member && message.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function totalBalance(user) {
  return user.wallet + user.bank;
}

function accountLine(user) {
  return "Portefeuille : **" + money(user.wallet) + "**\nBanque : **" + money(user.bank) + "**\nTotal : **" + money(totalBalance(user)) + "**";
}

const messageCooldowns = new Map();
const workMessages = [
  "Tu as livré des pizzas",
  "Tu as réparé un ordinateur",
  "Tu as gardé un dragon",
  "Tu as gagné un tournoi de bras de fer",
  "Tu as aidé dans une boutique"
];

const suits = ["♠", "♥", "♦", "♣"];
const ranks = [
  ["A", 11], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6],
  ["7", 7], ["8", 8], ["9", 9], ["10", 10], ["J", 10], ["Q", 10], ["K", 10]
];

function newDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const [rank, value] of ranks) deck.push({ suit, rank, value });
  }
  return shuffle(deck);
}

function handValue(hand) {
  let total = hand.reduce((sum, card) => sum + card.value, 0);
  let aces = hand.filter(card => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function handText(hand) {
  return hand.map(card => card.rank + card.suit).join(" ");
}

function blackjackText(game, revealDealer) {
  const dealer = revealDealer ? handText(game.dealer) : game.dealer[0].rank + game.dealer[0].suit + " ??";
  const dealerScore = revealDealer ? handValue(game.dealer) : "?";
  return "**Croupier** : " + dealer + " (" + dealerScore + ")\n**Toi** : " + handText(game.player) + " (" + handValue(game.player) + ")";
}

function settleBlackjack(guildId, userId, result, message) {
  const guild = guildData(guildId);
  const game = guild.blackjack[userId];
  if (!game) return;
  const user = userData(guildId, userId);
  let payout = 0;
  if (result === "win") payout = game.bet * 2;
  if (result === "tie") payout = game.bet;
  user.wallet += payout;
  delete guild.blackjack[userId];
  saveDatabase();
  const label = result === "win" ? "Tu gagnes" : result === "tie" ? "Égalité, mise remboursée" : "Tu perds";
  message.reply(label + (payout ? " : **" + money(payout) + "**" : "."));
}

function playBlackjackStand(message) {
  const guild = guildData(message.guild.id);
  const game = guild.blackjack[message.author.id];
  if (!game) return message.reply("Tu n'as pas de blackjack en cours. Lance-en un avec +blackjack <mise>.");
  while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
  const playerScore = handValue(game.player);
  const dealerScore = handValue(game.dealer);
  let result = "lose";
  if (dealerScore > 21 || playerScore > dealerScore) result = "win";
  else if (playerScore === dealerScore) result = "tie";
  message.reply("🃏\n" + blackjackText(game, true) + "\n\n" + (result === "win" ? "Tu remportes la partie !" : result === "tie" ? "Égalité." : "Le croupier gagne."));
  settleBlackjack(message.guild.id, message.author.id, result, message);
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("🎮 Hirosaki Game")
    .setDescription("Le bot de jeu et d'économie du serveur.\nToutes les commandes commencent par +ec.")
    .addFields(
      { name: "💰 Économie", value: "+ec balance — voir ton argent\n+ec work — travailler\n+ec daily — récompense quotidienne\n+ec deposit <montant> — déposer\n+ec withdraw <montant> — retirer\n+ec leaderboard — classement", inline: false },
      { name: "🎰 Jeux", value: "+ec blackjack <mise> — blackjack\n+ec hit / +ec stand — jouer au blackjack\n+ec coinflip <mise> <pile|face>\n+ec dice <mise> <1-6>\n+ec slots <mise>\n+ec roulette <mise> <rouge|noir|0-36>", inline: false },
      { name: "🕵️ Interaction", value: "+ec steal @membre — tenter un vol", inline: false },
      { name: "🛡️ Administration", value: "+ec addmoney @membre <montant>", inline: false }
    )
    .setFooter({ text: "Préfixe : +ec • Les mises sont retirées avant chaque partie" })
    .setTimestamp();
}

async function handleCommand(message) {
  const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const first = choice(parts.shift());
  const shortcut = { "help-ec": "help", "echelp": "help", "leaderboard-ec": "leaderboard", "ecleaderboard": "leaderboard" }[first];
  const namespaced = ["ec", "eco", "economie", "casino"].includes(first);
  if (!namespaced && !shortcut) return;
  const command = shortcut || choice(namespaced ? parts.shift() : first);
  if (!command) return;
  const guildId = message.guild.id;
  const userId = message.author.id;
  const user = userData(guildId, userId);

  if (command === "help" || command === "aide") return message.reply({ embeds: [helpEmbed()] });

  if (["balance", "bal", "money"].includes(command)) {
    return message.reply("💰 **" + message.author.username + "**\n" + accountLine(user));
  }

  if (command === "work" || command === "travail") {
    const availableAt = user.lastWork + WORK_COOLDOWN;
    if (availableAt > Date.now()) return message.reply("Tu as déjà travaillé récemment. Reviens dans **" + remaining(availableAt) + "**.");
    const reward = randomInt(35, 90);
    user.wallet += reward;
    user.lastWork = Date.now();
    saveDatabase();
    return message.reply("🛠️ " + workMessages[randomInt(0, workMessages.length - 1)] + " et tu gagnes **" + money(reward) + "** !");
  }

  if (command === "daily" || command === "quotidien") {
    const availableAt = user.lastDaily + DAILY_COOLDOWN;
    if (availableAt > Date.now()) return message.reply("Ta récompense quotidienne revient dans **" + remaining(availableAt) + "**.");
    const reward = randomInt(150, 300);
    user.wallet += reward;
    user.lastDaily = Date.now();
    saveDatabase();
    return message.reply("🎁 Tu récupères **" + money(reward) + "** pour ta récompense quotidienne !");
  }

  if (command === "deposit" || command === "depot") {
    const amount = parseAmount(parts[0], user.wallet);
    if (!amount || amount > user.wallet) return message.reply("Indique un montant valide disponible dans ton portefeuille.");
    user.wallet -= amount;
    user.bank += amount;
    saveDatabase();
    return message.reply("🏦 Tu déposes **" + money(amount) + "**.\n" + accountLine(user));
  }

  if (command === "withdraw" || command === "retrait") {
    const amount = parseAmount(parts[0], user.bank);
    if (!amount || amount > user.bank) return message.reply("Indique un montant valide disponible dans ta banque.");
    user.bank -= amount;
    user.wallet += amount;
    saveDatabase();
    return message.reply("🏧 Tu retires **" + money(amount) + "**.\n" + accountLine(user));
  }

  if (["leaderboard", "classement", "rich"].includes(command)) {
    const guild = guildData(guildId);
    const rows = Object.entries(guild.users).map(([id, value]) => ({ id, total: totalBalance(value) })).sort((a, b) => b.total - a.total).slice(0, 10);
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("🏆 Classement Hirosaki Game")
      .setDescription("Les joueurs les plus riches de ce serveur")
      .setFooter({ text: "Utilise +ec balance pour consulter ton compte" })
      .setTimestamp();
    if (!rows.length) {
      embed.setDescription("Le classement est encore vide. Commence avec +ec work !");
      return message.reply({ embeds: [embed] });
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((row, index) => (medals[index] || "▫️") + " **#" + (index + 1) + "** <@" + row.id + ">\n　💰 " + money(row.total));
    embed.addFields({ name: "Top 10", value: lines.join("\n") });
    return message.reply({ embeds: [embed] });
  }

  if (command === "steal" || command === "vol") {
    const target = memberMention(message, 0);
    if (!target) return message.reply("Mentionne la personne que tu veux voler : +steal @membre.");
    if (target.id === userId || target.user.bot) return message.reply("Tu ne peux pas voler cette personne.");
    const availableAt = user.lastSteal + STEAL_COOLDOWN;
    if (availableAt > Date.now()) return message.reply("Ton prochain vol sera possible dans **" + remaining(availableAt) + "**.");
    const victim = userData(guildId, target.id);
    if (victim.wallet < 10) return message.reply("Cette personne n'a pas assez de coins dans son portefeuille.");
    user.lastSteal = Date.now();
    if (Math.random() < 0.45) {
      const amount = Math.max(1, Math.min(victim.wallet, randomInt(Math.ceil(victim.wallet * 0.1), Math.max(10, Math.floor(victim.wallet * 0.35)))));
      victim.wallet -= amount;
      user.wallet += amount;
      saveDatabase();
      return message.reply("🕵️ Vol réussi ! Tu prends **" + money(amount) + "** à <@" + target.id + ">.");
    }
    const penalty = Math.min(user.wallet, randomInt(5, 25));
    user.wallet -= penalty;
    saveDatabase();
    return message.reply("🚨 Tu t'es fait prendre ! Tu paies **" + money(penalty) + "** d'amende.");
  }

  if (command === "addmoney" || command === "addcoins") {
    if (!isAdmin(message)) return message.reply("Cette commande est réservée aux administrateurs.");
    const target = memberMention(message, 0);
    const amount = parseAmount(parts[1], Number.MAX_SAFE_INTEGER);
    if (!target || !amount) return message.reply("Utilisation : +addmoney @membre <montant>.");
    const targetUser = userData(guildId, target.id);
    targetUser.wallet += amount;
    saveDatabase();
    return message.reply("✅ **" + money(amount) + "** ajoutés au portefeuille de <@" + target.id + ">.");
  }

  if (["coinflip", "flip", "pileface"].includes(command)) {
    const bet = parseAmount(parts[0], user.wallet);
    const pick = choice(parts[1]);
    if (!bet || bet > user.wallet || !["pile", "face"].includes(pick)) return message.reply("Utilisation : +coinflip <mise> <pile|face>.");
    user.wallet -= bet;
    const result = Math.random() < 0.5 ? "pile" : "face";
    if (pick === result) {
      const payout = bet * 2;
      user.wallet += payout;
      saveDatabase();
      return message.reply("🪙 C'est **" + result + "** ! Tu gagnes **" + money(payout) + "**.");
    }
    saveDatabase();
    return message.reply("🪙 C'est **" + result + "**. Tu perds ta mise de **" + money(bet) + "**.");
  }

  if (command === "dice" || command === "de") {
    const bet = parseAmount(parts[0], user.wallet);
    const pick = Number(parts[1]);
    if (!bet || bet > user.wallet || !Number.isInteger(pick) || pick < 1 || pick > 6) return message.reply("Utilisation : +dice <mise> <1-6>.");
    user.wallet -= bet;
    const result = randomInt(1, 6);
    if (pick === result) {
      const payout = bet * 6;
      user.wallet += payout;
      saveDatabase();
      return message.reply("🎲 Le dé affiche **" + result + "** ! Tu gagnes **" + money(payout) + "**.");
    }
    saveDatabase();
    return message.reply("🎲 Le dé affiche **" + result + "**. Tu perds ta mise de **" + money(bet) + "**.");
  }

  if (command === "slots" || command === "slot") {
    const bet = parseAmount(parts[0], user.wallet);
    if (!bet || bet > user.wallet) return message.reply("Utilisation : +slots <mise>.");
    const symbols = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
    const spin = [symbols[randomInt(0, symbols.length - 1)], symbols[randomInt(0, symbols.length - 1)], symbols[randomInt(0, symbols.length - 1)]];
    user.wallet -= bet;
    let multiplier = 0;
    if (spin[0] === spin[1] && spin[1] === spin[2]) multiplier = { "🍒": 5, "🍋": 6, "🔔": 8, "⭐": 10, "💎": 15, "7️⃣": 25 }[spin[0]];
    else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) multiplier = 2;
    const payout = bet * multiplier;
    user.wallet += payout;
    saveDatabase();
    if (payout) return message.reply("🎰 " + spin.join(" | ") + "\nTu remportes **" + money(payout) + "** !");
    return message.reply("🎰 " + spin.join(" | ") + "\nPas de combinaison gagnante cette fois.");
  }

  if (command === "roulette") {
    const bet = parseAmount(parts[0], user.wallet);
    const pick = choice(parts[1]);
    const validNumber = /^\d+$/.test(pick) && Number(pick) >= 0 && Number(pick) <= 36;
    if (!bet || bet > user.wallet || (!validNumber && !["rouge", "red", "noir", "black"].includes(pick))) return message.reply("Utilisation : +roulette <mise> <rouge|noir|0-36>.");
    user.wallet -= bet;
    const result = randomInt(0, 36);
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    const color = result === 0 ? "vert" : redNumbers.includes(result) ? "rouge" : "noir";
    const wonNumber = validNumber && Number(pick) === result;
    const wonColor = (pick === "rouge" || pick === "red") && color === "rouge" || (pick === "noir" || pick === "black") && color === "noir";
    const payout = wonNumber ? bet * 36 : wonColor ? bet * 2 : 0;
    user.wallet += payout;
    saveDatabase();
    if (payout) return message.reply("🎡 La roulette tombe sur **" + result + " (" + color + ")**. Tu gagnes **" + money(payout) + "** !");
    return message.reply("🎡 La roulette tombe sur **" + result + " (" + color + ")**. Ta mise est perdue.");
  }

  if (command === "blackjack" || command === "bj") {
    const guild = guildData(guildId);
    if (guild.blackjack[userId]) return message.reply("Tu as déjà une partie en cours. Utilise +hit ou +stand.");
    const bet = parseAmount(parts[0], user.wallet);
    if (!bet || bet > user.wallet) return message.reply("Utilisation : +blackjack <mise>.");
    user.wallet -= bet;
    const game = { bet, deck: newDeck(), player: [], dealer: [] };
    game.player.push(game.deck.pop(), game.deck.pop());
    game.dealer.push(game.deck.pop(), game.deck.pop());
    guild.blackjack[userId] = game;
    const playerScore = handValue(game.player);
    const dealerScore = handValue(game.dealer);
    if (playerScore === 21) {
      const payout = Math.floor(bet * 2.5);
      user.wallet += payout;
      delete guild.blackjack[userId];
      saveDatabase();
      return message.reply("🃏\n" + blackjackText(game, true) + "\nBlackjack naturel ! Tu gagnes **" + money(payout) + "**.");
    }
    if (dealerScore === 21) {
      delete guild.blackjack[userId];
      saveDatabase();
      return message.reply("🃏\n" + blackjackText(game, true) + "\nLe croupier a un blackjack. Tu perds ta mise.");
    }
    saveDatabase();
    return message.reply("🃏\n" + blackjackText(game, false) + "\nUtilise +hit pour tirer ou +stand pour rester.");
  }

  if (command === "hit" || command === "tirer") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return message.reply("Tu n'as pas de blackjack en cours. Lance-en un avec +blackjack <mise>.");
    game.player.push(game.deck.pop());
    const score = handValue(game.player);
    if (score > 21) {
      delete guild.blackjack[userId];
      saveDatabase();
      return message.reply("🃏\n" + blackjackText(game, true) + "\nTu dépasses 21. Partie perdue.");
    }
    saveDatabase();
    return message.reply("🃏\n" + blackjackText(game, false) + "\n+hit ou +stand ?");
  }

  if (command === "stand" || command === "rester") return playBlackjackStand(message);

  return message.reply("Commande inconnue. Utilise +help pour voir les commandes.");
}

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;
  const user = userData(message.guild.id, message.author.id);

  if (!message.content.startsWith(PREFIX)) {
    const key = message.guild.id + ":" + message.author.id;
    const lastReward = messageCooldowns.get(key) || 0;
    if (Date.now() - lastReward >= MESSAGE_COOLDOWN) {
      const reward = randomInt(2, 8);
      user.wallet += reward;
      messageCooldowns.set(key, Date.now());
      saveDatabase();
    }
    return;
  }

  try {
    await handleCommand(message);
  } catch (error) {
    console.error("Erreur de commande :", error);
    await message.reply("Une erreur est survenue pendant l'exécution de la commande.");
  }
});

client.once("clientReady", () => {
  console.log("✅ " + client.user.tag + " est connecté sur " + client.guilds.cache.size + " serveur(s).");
  console.log("Préfixe : " + PREFIX + " | Données : " + DATA_FILE);
  client.user.setActivity(PREFIX + "help", { type: ActivityType.Listening });
});

async function shutdown(signal) {
  console.log(signal + " reçu, sauvegarde en cours...");
  saveDatabase();
  await new Promise(resolve => setTimeout(resolve, 400));
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", error => console.error("Unhandled rejection :", error));
process.on("uncaughtException", error => console.error("Uncaught exception :", error));

client.login(TOKEN);
