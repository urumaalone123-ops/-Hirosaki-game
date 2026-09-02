const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder
} = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKEN = process.env.DISCORD_TOKEN;
const DATA_FILE = path.resolve(process.env.DATA_FILE || "data/economy.json");
const MESSAGE_COOLDOWN = 60 * 1000;
const WORK_COOLDOWN = 45 * 1000;
const STEAL_COOLDOWN = 10 * 60 * 1000;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;

if (!TOKEN) {
  console.error("DISCORD_TOKEN est absent. Ajoute-le dans les variables d'environnement.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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
    console.error("Impossible de lire la base JSON :", error.message);
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
  if (!db.guilds[guildId].shop) db.guilds[guildId].shop = { items: {} };
  if (!db.guilds[guildId].shop.items) db.guilds[guildId].shop.items = {};
  return db.guilds[guildId];
}

function userData(guildId, userId) {
  const guild = guildData(guildId);
  if (!guild.users[userId]) guild.users[userId] = { wallet: 100, bank: 0, lastDaily: 0, lastWork: 0, lastSteal: 0 };
  const user = guild.users[userId];
  if (!Array.isArray(user.inventory)) user.inventory = [];
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
  if (value === undefined || value === null || value === "") return null;
  if (String(value).toLowerCase() === "all") return Math.floor(available);
  const amount = Number(String(value).replaceAll(",", ".").replaceAll(" ", ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function remaining(until) {
  const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  if (seconds >= 3600) return Math.ceil(seconds / 3600) + " h";
  if (seconds >= 60) return Math.ceil(seconds / 60) + " min";
  return seconds + " s";
}

function normalizeChoice(value) {
  return String(value || "").toLowerCase().trim();
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
const ranks = [["A", 11], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8], ["9", 9], ["10", 10], ["J", 10], ["Q", 10], ["K", 10]];

function newDeck() {
  const deck = [];
  for (const suit of suits) for (const [rank, value] of ranks) deck.push({ suit, rank, value });
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

function balanceEmbed(username, user) {
  return new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("💰 Compte de " + username)
    .setDescription("Voici ta situation financière sur ce serveur.")
    .addFields(
      { name: "👛 Portefeuille", value: "**" + money(user.wallet) + "**", inline: true },
      { name: "🏦 Banque", value: "**" + money(user.bank) + "**", inline: true },
      { name: "📊 Total", value: "**" + money(totalBalance(user)) + "**", inline: false }
    )
    .setFooter({ text: "Les jeux utilisent l'argent du portefeuille" })
    .setTimestamp();
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("🎮 Hirosaki Game")
    .setDescription("Le bot de jeu et d'économie du serveur.\nLes commandes sont disponibles dans le menu slash Discord.")
    .addFields(
      { name: "💰 Économie", value: "/balance — voir ton argent\n/work — travailler\n/daily — récompense quotidienne\n/deposit montant:<montant> — déposer\n/withdraw montant:<montant> — retirer\n/leaderboard — classement", inline: false },
      { name: "🎰 Jeux", value: "/blackjack mise:<montant> — blackjack\n/hit et /stand — jouer au blackjack\n/coinflip mise:<montant> choix:<pile|face>\n/dice mise:<montant> choix:<1-6>\n/slots mise:<montant>\n/roulette mise:<montant> pari:<rouge|noir|0-36>", inline: false },
      { name: "🕵️ Interaction", value: "/steal membre:<membre> — tenter un vol", inline: false },
      { name: "🛡️ Administration", value: "/addmoney membre:<membre> montant:<montant>", inline: false }
    )
    .setFooter({ text: "Les mises sont retirées avant chaque partie" })
    .setTimestamp();
}

function leaderboardEmbed(guildId) {
  const guild = guildData(guildId);
  const rows = Object.entries(guild.users).map(([id, value]) => ({ id, total: totalBalance(value) })).sort((a, b) => b.total - a.total).slice(0, 10);
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🏆 Classement Hirosaki Game")
    .setDescription("Les joueurs les plus riches de ce serveur")
    .setFooter({ text: "Utilise /balance pour consulter ton compte" })
    .setTimestamp();
  if (!rows.length) return embed.setDescription("Le classement est encore vide. Commence avec /work !");
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((row, index) => (medals[index] || "▫️") + " **#" + (index + 1) + "** <@" + row.id + ">\n　💰 " + money(row.total));
  return embed.addFields({ name: "Top 10", value: lines.join("\n") });
}

function normalizeItemId(value) {
  const raw = String(value || '').toLowerCase().trim();
  return raw.replace(/[^a-z0-9_-]/g, '').slice(0, 20);
}

function parseStock(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = normalizeChoice(value);
  if (normalized === 'illimite' || normalized === 'infinite' || normalized === 'unlimited') return -1;
  const stock = Number(value);
  return Number.isSafeInteger(stock) && stock >= 0 ? stock : null;
}

function shopEmbed(guildId) {
  const guild = guildData(guildId);
  const items = Object.values(guild.shop.items);
  const embed = new EmbedBuilder().setColor(0x06b6d4).setTitle('🛒 Boutique Hirosaki').setDescription("Achète des objets avec l'argent de ton portefeuille. Utilise /buy pour acheter.").setFooter({ text: 'Les articles sont configurés directement sur Discord' }).setTimestamp();
  if (!items.length) return embed.setDescription('La boutique est vide pour le moment.');
  const lines = items.slice(0, 25).map(item => {
    const stock = item.stock === -1 ? '∞' : String(item.stock);
    const role = item.roleId ? ' • rôle inclus' : '';
    return '🛍️ **' + item.name + '** — **' + money(item.price) + '**\nID : ' + item.id + ' • Stock : ' + stock + role + '\n' + item.description;
  });
  return embed.setDescription(lines.join(String.fromCharCode(10) + String.fromCharCode(10)));
}

function inventoryEmbed(username, user) {
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle('🎒 Inventaire de ' + username).setTimestamp();
  if (!user.inventory.length) return embed.setDescription('Ton inventaire est vide. Consulte /shop pour voir les articles.');
  const counts = {};
  for (const item of user.inventory) counts[item.id] = (counts[item.id] || 0) + (item.quantity || 1);
  const lines = Object.entries(counts).map(([id, quantity]) => '• **' + id + '** × ' + quantity);
  return embed.setDescription(lines.join(String.fromCharCode(10)));
}

function commandBuilders() {
  const amountOption = option => option.setName("montant").setDescription("Montant ou all").setRequired(true);
  return [
    new SlashCommandBuilder().setName("shop").setDescription("Afficher la boutique du serveur"),
    new SlashCommandBuilder().setName("buy").setDescription("Acheter un article").addStringOption(option => option.setName("item").setDescription("ID de l article").setRequired(true)).addIntegerOption(option => option.setName("quantite").setDescription("Quantité").setMinValue(1).setMaxValue(99).setRequired(true)),
    new SlashCommandBuilder().setName("inventory").setDescription("Voir ton inventaire"),
    new SlashCommandBuilder().setName("shop-create").setDescription("Créer un article").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild).addStringOption(option => option.setName("id").setDescription("ID court sans espace").setRequired(true)).addStringOption(option => option.setName("nom").setDescription("Nom affiché").setMaxLength(80).setRequired(true)).addIntegerOption(option => option.setName("prix").setDescription("Prix en coins").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("description").setDescription("Description").setMaxLength(200).setRequired(true)).addStringOption(option => option.setName("stock").setDescription("Nombre ou illimite").setRequired(false)).addRoleOption(option => option.setName("role").setDescription("Rôle donné à l achat").setRequired(false)),
    new SlashCommandBuilder().setName("shop-edit").setDescription("Modifier un article").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild).addStringOption(option => option.setName("id").setDescription("ID de l article").setRequired(true)).addStringOption(option => option.setName("nom").setDescription("Nouveau nom").setMaxLength(80).setRequired(false)).addIntegerOption(option => option.setName("prix").setDescription("Nouveau prix").setMinValue(1).setRequired(false)).addStringOption(option => option.setName("description").setDescription("Nouvelle description").setMaxLength(200).setRequired(false)).addStringOption(option => option.setName("stock").setDescription("Nombre ou illimite").setRequired(false)).addRoleOption(option => option.setName("role").setDescription("Nouveau rôle").setRequired(false)),
    new SlashCommandBuilder().setName("shop-delete").setDescription("Supprimer un article").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild).addStringOption(option => option.setName("id").setDescription("ID de l article").setRequired(true)),
    new SlashCommandBuilder().setName("shop-list").setDescription("Lister les articles").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    new SlashCommandBuilder().setName("rps").setDescription("Jouer à pierre papier ciseaux").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("choix").setDescription("Ton choix").addChoices({ name: "Pierre", value: "pierre" }, { name: "Papier", value: "papier" }, { name: "Ciseaux", value: "ciseaux" }).setRequired(true)),
    new SlashCommandBuilder().setName("higherlower").setDescription("Deviner si la carte monte ou descend").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("choix").setDescription("Plus haut ou plus bas").addChoices({ name: "Plus haut", value: "haut" }, { name: "Plus bas", value: "bas" }).setRequired(true)), 
    new SlashCommandBuilder().setName("help").setDescription("Afficher l'aide du bot de jeu"),
    new SlashCommandBuilder().setName("balance").setDescription("Voir ton portefeuille et ta banque"),
    new SlashCommandBuilder().setName("work").setDescription("Travailler pour gagner des coins"),
    new SlashCommandBuilder().setName("daily").setDescription("Récupérer ta récompense quotidienne"),
    new SlashCommandBuilder().setName("deposit").setDescription("Déposer des coins à la banque").addStringOption(amountOption),
    new SlashCommandBuilder().setName("withdraw").setDescription("Retirer des coins de la banque").addStringOption(amountOption),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Afficher le classement des fortunes"),
    new SlashCommandBuilder().setName("steal").setDescription("Tenter de voler le portefeuille d'un membre").addUserOption(option => option.setName("membre").setDescription("Membre ciblé").setRequired(true)),
    new SlashCommandBuilder().setName("addmoney").setDescription("Ajouter des coins à un membre").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator).addUserOption(option => option.setName("membre").setDescription("Membre à créditer").setRequired(true)).addIntegerOption(option => option.setName("montant").setDescription("Nombre de coins").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("coinflip").setDescription("Jouer à pile ou face").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("choix").setDescription("Ton choix").addChoices({ name: "Pile", value: "pile" }, { name: "Face", value: "face" }).setRequired(true)),
    new SlashCommandBuilder().setName("dice").setDescription("Parier sur un résultat de dé").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)).addIntegerOption(option => option.setName("choix").setDescription("Nombre choisi").setMinValue(1).setMaxValue(6).setRequired(true)),
    new SlashCommandBuilder().setName("slots").setDescription("Lancer la machine à sous").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("roulette").setDescription("Jouer à la roulette").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("pari").setDescription("rouge, noir ou un nombre de 0 à 36").setRequired(true)),
    new SlashCommandBuilder().setName("blackjack").setDescription("Commencer une partie de blackjack").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("hit").setDescription("Tirer une carte au blackjack"),
    new SlashCommandBuilder().setName("stand").setDescription("Rester au blackjack")
  ].map(command => command.toJSON());
}

function payoutBlackjack(guildId, userId, result) {
  const guild = guildData(guildId);
  const game = guild.blackjack[userId];
  if (!game) return 0;
  const user = userData(guildId, userId);
  const payout = result === "win" ? game.bet * 2 : result === "tie" ? game.bet : 0;
  user.wallet += payout;
  delete guild.blackjack[userId];
  saveDatabase();
  return payout;
}

async function handleInteraction(interaction) {
  if (!interaction.guild) return interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const user = userData(guildId, userId);
  const command = interaction.commandName;

  if (command === "help") return interaction.reply({ embeds: [helpEmbed()] });
  if (command === "balance") return interaction.reply({ embeds: [balanceEmbed(interaction.user.username, user)] });

  if (command === "work") {
    const availableAt = user.lastWork + WORK_COOLDOWN;
    if (availableAt > Date.now()) return interaction.reply({ content: "Tu as déjà travaillé récemment. Reviens dans **" + remaining(availableAt) + "**.", ephemeral: true });
    const reward = randomInt(35, 90);
    user.wallet += reward;
    user.lastWork = Date.now();
    saveDatabase();
    return interaction.reply({ content: "🛠️ " + workMessages[randomInt(0, workMessages.length - 1)] + " et tu gagnes **" + money(reward) + "** !" });
  }

  if (command === "daily") {
    const availableAt = user.lastDaily + DAILY_COOLDOWN;
    if (availableAt > Date.now()) return interaction.reply({ content: "Ta récompense quotidienne revient dans **" + remaining(availableAt) + "**.", ephemeral: true });
    const reward = randomInt(150, 300);
    user.wallet += reward;
    user.lastDaily = Date.now();
    saveDatabase();
    return interaction.reply({ content: "🎁 Tu récupères **" + money(reward) + "** pour ta récompense quotidienne !" });
  }

  if (command === "deposit" || command === "withdraw") {
    const amount = parseAmount(interaction.options.getString("montant"), command === "deposit" ? user.wallet : user.bank);
    if (!amount || amount > (command === "deposit" ? user.wallet : user.bank)) return interaction.reply({ content: "Indique un montant valide disponible dans ton compte.", ephemeral: true });
    if (command === "deposit") {
      user.wallet -= amount;
      user.bank += amount;
    } else {
      user.bank -= amount;
      user.wallet += amount;
    }
    saveDatabase();
    return interaction.reply({ content: (command === "deposit" ? "🏦 Tu déposes **" : "🏧 Tu retires **") + money(amount) + "**.\n" + accountLine(user) });
  }

  if (command === "leaderboard") return interaction.reply({ embeds: [leaderboardEmbed(guildId)] });

  if (command === "steal") {
    const target = interaction.options.getMember("membre");
    if (!target || target.user.bot || target.id === userId) return interaction.reply({ content: "Tu ne peux pas voler cette personne.", ephemeral: true });
    const availableAt = user.lastSteal + STEAL_COOLDOWN;
    if (availableAt > Date.now()) return interaction.reply({ content: "Ton prochain vol sera possible dans **" + remaining(availableAt) + "**.", ephemeral: true });
    const victim = userData(guildId, target.id);
    if (victim.wallet < 10) return interaction.reply({ content: "Cette personne n'a pas assez de coins dans son portefeuille.", ephemeral: true });
    user.lastSteal = Date.now();
    if (Math.random() < 0.45) {
      const amount = Math.max(1, Math.min(victim.wallet, randomInt(Math.ceil(victim.wallet * 0.1), Math.max(10, Math.floor(victim.wallet * 0.35)))));
      victim.wallet -= amount;
      user.wallet += amount;
      saveDatabase();
      return interaction.reply({ content: "🕵️ Vol réussi ! Tu prends **" + money(amount) + "** à <@" + target.id + ">." });
    }
    const penalty = Math.min(user.wallet, randomInt(5, 25));
    user.wallet -= penalty;
    saveDatabase();
    return interaction.reply({ content: "🚨 Tu t'es fait prendre ! Tu paies **" + money(penalty) + "** d'amende." });
  }

  if (command === "addmoney") {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: "Cette commande est réservée aux administrateurs.", ephemeral: true });
    const target = interaction.options.getUser("membre");
    const amount = interaction.options.getInteger("montant");
    const targetUser = userData(guildId, target.id);
    targetUser.wallet += amount;
    saveDatabase();
    return interaction.reply({ content: "✅ **" + money(amount) + "** ajoutés au portefeuille de <@" + target.id + ">." });
  }

  if (command === "coinflip") {
    const bet = interaction.options.getInteger("mise");
    const pick = normalizeChoice(interaction.options.getString("choix"));
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    user.wallet -= bet;
    const result = Math.random() < 0.5 ? "pile" : "face";
    if (pick === result) {
      const payout = bet * 2;
      user.wallet += payout;
      saveDatabase();
      return interaction.reply({ content: "🪙 C'est **" + result + "** ! Tu gagnes **" + money(payout) + "**." });
    }
    saveDatabase();
    return interaction.reply({ content: "🪙 C'est **" + result + "**. Tu perds ta mise de **" + money(bet) + "**." });
  }

  if (command === "dice") {
    const bet = interaction.options.getInteger("mise");
    const pick = interaction.options.getInteger("choix");
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    user.wallet -= bet;
    const result = randomInt(1, 6);
    if (pick === result) {
      const payout = bet * 6;
      user.wallet += payout;
      saveDatabase();
      return interaction.reply({ content: "🎲 Le dé affiche **" + result + "** ! Tu gagnes **" + money(payout) + "**." });
    }
    saveDatabase();
    return interaction.reply({ content: "🎲 Le dé affiche **" + result + "**. Tu perds ta mise de **" + money(bet) + "**." });
  }

  if (command === "slots") {
    const bet = interaction.options.getInteger("mise");
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    const symbols = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
    const spin = [symbols[randomInt(0, 5)], symbols[randomInt(0, 5)], symbols[randomInt(0, 5)]];
    user.wallet -= bet;
    let multiplier = 0;
    if (spin[0] === spin[1] && spin[1] === spin[2]) multiplier = { "🍒": 5, "🍋": 6, "🔔": 8, "⭐": 10, "💎": 15, "7️⃣": 25 }[spin[0]];
    else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) multiplier = 2;
    const payout = bet * multiplier;
    user.wallet += payout;
    saveDatabase();
    return interaction.reply({ content: "🎰 " + spin.join(" | ") + "\n" + (payout ? "Tu remportes **" + money(payout) + "** !" : "Pas de combinaison gagnante cette fois.") });
  }

  if (command === "roulette") {
    const bet = interaction.options.getInteger("mise");
    const pick = normalizeChoice(interaction.options.getString("pari"));
    const numberPick = Number(pick);
    const validNumber = Number.isInteger(numberPick) && numberPick >= 0 && numberPick <= 36 && String(numberPick) === pick;
    if (bet > user.wallet || (!validNumber && !["rouge", "noir", "red", "black"].includes(pick))) return interaction.reply({ content: "Choisis rouge, noir ou un nombre entre 0 et 36, avec une mise disponible.", ephemeral: true });
    user.wallet -= bet;
    const result = randomInt(0, 36);
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    const color = result === 0 ? "vert" : redNumbers.includes(result) ? "rouge" : "noir";
    const wonNumber = validNumber && numberPick === result;
    const wonColor = ["rouge", "red"].includes(pick) && color === "rouge" || ["noir", "black"].includes(pick) && color === "noir";
    const payout = wonNumber ? bet * 36 : wonColor ? bet * 2 : 0;
    user.wallet += payout;
    saveDatabase();
    return interaction.reply({ content: "🎡 La roulette tombe sur **" + result + " (" + color + ")**. " + (payout ? "Tu gagnes **" + money(payout) + "** !" : "Ta mise est perdue.") });
  }

  if (command === "blackjack") {
    const guild = guildData(guildId);
    if (guild.blackjack[userId]) return interaction.reply({ content: "Tu as déjà une partie en cours. Utilise /hit ou /stand.", ephemeral: true });
    const bet = interaction.options.getInteger("mise");
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
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
      return interaction.reply({ content: "🃏\n" + blackjackText(game, true) + "\nBlackjack naturel ! Tu gagnes **" + money(payout) + "**." });
    }
    if (dealerScore === 21) {
      delete guild.blackjack[userId];
      saveDatabase();
      return interaction.reply({ content: "🃏\n" + blackjackText(game, true) + "\nLe croupier a un blackjack. Tu perds ta mise." });
    }
    saveDatabase();
    return interaction.reply({ content: "🃏\n" + blackjackText(game, false) + "\nUtilise /hit pour tirer ou /stand pour rester." });
  }

  if (command === "hit") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return interaction.reply({ content: "Tu n'as pas de blackjack en cours. Lance /blackjack.", ephemeral: true });
    game.player.push(game.deck.pop());
    const score = handValue(game.player);
    if (score > 21) {
      delete guild.blackjack[userId];
      saveDatabase();
      return interaction.reply({ content: "🃏\n" + blackjackText(game, true) + "\nTu dépasses 21. Partie perdue." });
    }
    saveDatabase();
    return interaction.reply({ content: "🃏\n" + blackjackText(game, false) + "\n/hit ou /stand ?" });
  }

  if (command === "stand") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return interaction.reply({ content: "Tu n'as pas de blackjack en cours. Lance /blackjack.", ephemeral: true });
    while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
    const playerScore = handValue(game.player);
    const dealerScore = handValue(game.dealer);
    const result = dealerScore > 21 || playerScore > dealerScore ? "win" : playerScore === dealerScore ? "tie" : "lose";
    const message = "🃏\n" + blackjackText(game, true) + "\n\n" + (result === "win" ? "Tu remportes la partie !" : result === "tie" ? "Égalité." : "Le croupier gagne.");
    const payout = payoutBlackjack(guildId, userId, result);
    return interaction.reply({ content: message + (payout ? "\nGain : **" + money(payout) + "**." : "") });
  }
}

client.on("messageCreate", message => {
  if (!message.guild || message.author.bot) return;
  const user = userData(message.guild.id, message.author.id);
  const key = message.guild.id + ":" + message.author.id;
  const lastReward = messageCooldowns.get(key) || 0;
  if (Date.now() - lastReward >= MESSAGE_COOLDOWN) {
    user.wallet += randomInt(2, 8);
    messageCooldowns.set(key, Date.now());
    saveDatabase();
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error("Erreur de commande slash :", error);
    const response = { content: "Une erreur est survenue pendant l'exécution de la commande.", ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response);
    else await interaction.reply(response);
  }
});

client.once("clientReady", async () => {
  try {
    const commands = commandBuilders();
    if (process.env.GUILD_ID) await client.application.commands.set(commands, process.env.GUILD_ID);
    else await client.application.commands.set(commands);
    console.log("✅ " + client.user.tag + " est connecté sur " + client.guilds.cache.size + " serveur(s).");
    console.log("✅ " + commands.length + " commandes slash enregistrées.");
    console.log("Préfixe : aucun — commandes slash Discord");
    client.user.setActivity("les commandes slash", { type: ActivityType.Listening });
  } catch (error) {
    console.error("Impossible d'enregistrer les commandes slash :", error.message);
  }
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
