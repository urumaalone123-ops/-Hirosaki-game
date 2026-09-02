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

function defaultShopSettings() {
  return {
    title: "🛒 Boutique Hirosaki",
    description: "Achète des objets avec l'argent de ton portefeuille.",
    color: 0x06b6d4,
    footer: "Les articles sont configurés directement sur Discord"
  };
}

function guildData(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = { users: {}, blackjack: {} };
  if (!db.guilds[guildId].users) db.guilds[guildId].users = {};
  if (!db.guilds[guildId].blackjack) db.guilds[guildId].blackjack = {};
  if (!db.guilds[guildId].shop) db.guilds[guildId].shop = { ...defaultShopSettings(), items: {} };
  const shop = db.guilds[guildId].shop;
  if (!shop.items) shop.items = {};
  const defaults = defaultShopSettings();
  if (!shop.title) shop.title = defaults.title;
  if (!shop.description) shop.description = defaults.description;
  if (!Number.isInteger(shop.color)) shop.color = defaults.color;
  if (!shop.footer) shop.footer = defaults.footer;
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
      { name: "🎰 Jeux", value: "/blackjack mise:<montant> — blackjack\n/hit, /stand, /split et /double\n/craps mise:<montant>\n/coinflip mise:<montant> choix:<pile|face>\n/dice mise:<montant> choix:<1-6>\n/slots mise:<montant>\n/roulette mise:<montant> pari:<rouge|noir|0-36>", inline: false },
      { name: "🕵️ Interaction", value: "/steal membre:<membre> — tenter un vol", inline: false },
      { name: "🛒 Boutique", value: "/shop — voir la boutique\n/buy item:<id> quantité:<nombre> — acheter\n/inventory — voir tes achats\n\nAdmin : /shop-create, /shop-edit, /shop-delete, /shop-list, /shop-config", inline: false }
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

function parseShopColor(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return parseInt(normalized, 16);
}

function shopEmbed(guildId) {
  const shop = guildData(guildId).shop;
  const items = Object.values(shop.items);
  const color = Number.isInteger(shop.color) ? shop.color : 0x06b6d4;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(String(shop.title || '🛒 Boutique Hirosaki').slice(0, 256))
    .setDescription(String(shop.description || 'Achète des objets avec ton portefeuille.').slice(0, 4096))
    .setFooter({ text: String(shop.footer || 'Les articles sont configurés directement sur Discord').slice(0, 2048) })
    .setTimestamp();
  if (!items.length) return embed.setDescription(String(shop.description || '') + (shop.description ? '\n\n' : '') + 'La boutique est vide pour le moment.');
  const categories = new Map();
  for (const item of items.slice(0, 25)) {
    const category = String(item.category || 'Général').slice(0, 40);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(item);
  }
  const sections = [];
  for (const [category, categoryItems] of categories) {
    const lines = categoryItems.map(item => {
      const stock = item.stock === -1 ? '∞' : String(item.stock ?? 0);
      const role = item.roleId ? ' • rôle inclus' : '';
      const emoji = item.emoji || '🛍️';
      return String(emoji) + ' **' + String(item.name) + '** — **' + money(item.price) + '**\nID : ' + item.id + ' • Stock : ' + stock + role + '\n' + String(item.description || '');
    });
    sections.push('**' + category + '**\n' + lines.join('\n\n'));
  }
  return embed.setDescription(sections.join('\n\n').slice(0, 4096));
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
  const manageShop = command => command.setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);
  return [
    new SlashCommandBuilder().setName("shop").setDescription("Afficher la boutique du serveur"),
    new SlashCommandBuilder().setName("buy").setDescription("Acheter un article").addStringOption(option => option.setName("item").setDescription("ID de l article").setRequired(true)).addIntegerOption(option => option.setName("quantite").setDescription("Quantité").setMinValue(1).setMaxValue(99).setRequired(true)),
    new SlashCommandBuilder().setName("inventory").setDescription("Voir ton inventaire"),
    manageShop(new SlashCommandBuilder().setName("shop-create").setDescription("Créer un article").addStringOption(option => option.setName("id").setDescription("ID court sans espace").setMaxLength(20).setRequired(true)).addStringOption(option => option.setName("nom").setDescription("Nom affiché").setMaxLength(80).setRequired(true)).addIntegerOption(option => option.setName("prix").setDescription("Prix en coins").setMinValue(1).setRequired(true)).addStringOption(option => option.setName("description").setDescription("Description").setMaxLength(200).setRequired(true)).addStringOption(option => option.setName("stock").setDescription("Nombre ou illimite").setRequired(false)).addStringOption(option => option.setName("emoji").setDescription("Emoji affiché").setMaxLength(32).setRequired(false)).addStringOption(option => option.setName("categorie").setDescription("Catégorie").setMaxLength(40).setRequired(false)).addRoleOption(option => option.setName("role").setDescription("Rôle donné à l achat").setRequired(false))),
    manageShop(new SlashCommandBuilder().setName("shop-edit").setDescription("Modifier un article").addStringOption(option => option.setName("id").setDescription("ID de l article").setMaxLength(20).setRequired(true)).addStringOption(option => option.setName("nom").setDescription("Nouveau nom").setMaxLength(80).setRequired(false)).addIntegerOption(option => option.setName("prix").setDescription("Nouveau prix").setMinValue(1).setRequired(false)).addStringOption(option => option.setName("description").setDescription("Nouvelle description").setMaxLength(200).setRequired(false)).addStringOption(option => option.setName("stock").setDescription("Nombre ou illimite").setRequired(false)).addStringOption(option => option.setName("emoji").setDescription("Nouvel emoji").setMaxLength(32).setRequired(false)).addStringOption(option => option.setName("categorie").setDescription("Nouvelle catégorie").setMaxLength(40).setRequired(false)).addRoleOption(option => option.setName("role").setDescription("Nouveau rôle").setRequired(false)).addBooleanOption(option => option.setName("retirer-role").setDescription("Retirer le rôle associé").setRequired(false))),
    manageShop(new SlashCommandBuilder().setName("shop-delete").setDescription("Supprimer un article").addStringOption(option => option.setName("id").setDescription("ID de l article").setMaxLength(20).setRequired(true))),
    manageShop(new SlashCommandBuilder().setName("shop-list").setDescription("Lister les articles")),
    manageShop(new SlashCommandBuilder().setName("shop-config").setDescription("Personnaliser l affichage de la boutique").addStringOption(option => option.setName("titre").setDescription("Titre de la boutique").setMaxLength(100).setRequired(false)).addStringOption(option => option.setName("description").setDescription("Description de la boutique").setMaxLength(400).setRequired(false)).addStringOption(option => option.setName("couleur").setDescription("Couleur hexadécimale, ex: 06b6d4").setMaxLength(7).setRequired(false)).addStringOption(option => option.setName("pied").setDescription("Texte du pied de page").setMaxLength(200).setRequired(false)).addBooleanOption(option => option.setName("reinitialiser").setDescription("Réinitialiser les réglages").setRequired(false))),
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
    new SlashCommandBuilder().setName("craps").setDescription("Jouer au craps classique").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("blackjack").setDescription("Commencer une partie de blackjack").addIntegerOption(option => option.setName("mise").setDescription("Nombre de coins").setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName("hit").setDescription("Tirer une carte au blackjack"),
    new SlashCommandBuilder().setName("stand").setDescription("Rester au blackjack"),
    new SlashCommandBuilder().setName("split").setDescription("Séparer une paire au blackjack"),
    new SlashCommandBuilder().setName("double").setDescription("Doubler la mise et tirer une carte")
  ].map(command => command.toJSON());
}

function blackjackHands(game) {
  if (Array.isArray(game.hands)) return game.hands;
  game.hands = [{ cards: game.player || [], bet: game.bet, finished: false }];
  return game.hands;
}

function currentBlackjackHand(game) {
  const hands = blackjackHands(game);
  return hands[game.activeHand || 0];
}

function advanceBlackjackHand(game) {
  const hands = blackjackHands(game);
  for (let index = 0; index < hands.length; index += 1) {
    if (!hands[index].finished) {
      game.activeHand = index;
      return true;
    }
  }
  return false;
}

function blackjackText(game, revealDealer) {
  const hands = blackjackHands(game);
  const dealer = revealDealer ? handText(game.dealer) : game.dealer[0].rank + game.dealer[0].suit + " ??";
  const dealerScore = revealDealer ? handValue(game.dealer) : "?";
  const players = hands.map((hand, index) => {
    const active = !hand.finished && index === (game.activeHand || 0) ? " ← en cours" : "";
    return "**Main " + (index + 1) + active + "** : " + handText(hand.cards) + " (" + handValue(hand.cards) + ")";
  }).join("\n");
  return "**Croupier** : " + dealer + " (" + dealerScore + ")\n" + players;
}

function settleBlackjack(guildId, userId) {
  const guild = guildData(guildId);
  const game = guild.blackjack[userId];
  if (!game) return { payout: 0, results: [] };
  const hands = blackjackHands(game);
  while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
  const dealerScore = handValue(game.dealer);
  let payout = 0;
  const results = hands.map(hand => {
    const playerScore = handValue(hand.cards);
    const result = playerScore > 21 ? "lose" : dealerScore > 21 || playerScore > dealerScore ? "win" : playerScore === dealerScore ? "tie" : "lose";
    if (result === "win") payout += hand.bet * 2;
    if (result === "tie") payout += hand.bet;
    return result;
  });
  userData(guildId, userId).wallet += payout;
  delete guild.blackjack[userId];
  saveDatabase();
  return { payout, results };
}

async function handleInteraction(interaction) {
  if (!interaction.guild) return interaction.reply({ content: "Cette commande doit être utilisée sur un serveur.", ephemeral: true });
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const user = userData(guildId, userId);
  const command = interaction.commandName;

  if (command === "help") return interaction.reply({ embeds: [helpEmbed()] });
  if (command === "balance") return interaction.reply({ embeds: [balanceEmbed(interaction.user.username, user)] });
  if (command === 'shop') return interaction.reply({ embeds: [shopEmbed(guildId)] });

  if (command === 'inventory') return interaction.reply({ embeds: [inventoryEmbed(interaction.user.username, user)] });

  if (command === 'buy') {
    const itemId = normalizeItemId(interaction.options.getString('item'));
    const quantity = interaction.options.getInteger('quantite');
    const item = guildData(guildId).shop.items[itemId];
    if (!item) return interaction.reply({ content: 'Article introuvable. Utilise /shop pour voir les IDs disponibles.', ephemeral: true });
    if (item.stock !== -1 && item.stock < quantity) return interaction.reply({ content: 'Il ne reste pas assez de stock pour cet article.', ephemeral: true });
    const total = item.price * quantity;
    if (!Number.isSafeInteger(total) || total > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    const role = item.roleId ? interaction.guild.roles.cache.get(item.roleId) : null;
    if (item.roleId && !role) return interaction.reply({ content: "Le rôle associé à cet article n'existe plus.", ephemeral: true });
    if (role) {
      try { await interaction.member.roles.add(role); } catch (error) { return interaction.reply({ content: 'Je ne peux pas donner le rôle associé. Vérifie la hiérarchie des rôles.', ephemeral: true }); }
    }
    user.wallet -= total;
    if (item.stock !== -1) item.stock -= quantity;
    const owned = user.inventory.find(entry => entry.id === itemId);
    if (owned) owned.quantity += quantity;
    else user.inventory.push({ id: itemId, name: item.name, quantity, purchasedAt: Date.now() });
    saveDatabase();
    return interaction.reply({ content: '✅ Achat confirmé : **' + quantity + ' × ' + item.name + '** pour **' + money(total) + '**.' + (role ? String.fromCharCode(10) + 'Le rôle a été ajouté.' : '') });
  }

  if (['shop-config', 'shop-create', 'shop-edit', 'shop-delete', 'shop-list'].includes(command)) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) && !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: 'Cette commande est réservée aux administrateurs.', ephemeral: true });
    const shop = guildData(guildId).shop;
    if (command === 'shop-config') {
      const reset = interaction.options.getBoolean('reinitialiser') === true;
      if (reset) {
        Object.assign(shop, defaultShopSettings());
        saveDatabase();
        return interaction.reply({ content: '✅ Réglages de la boutique réinitialisés.', embeds: [shopEmbed(guildId)] });
      }
      const title = interaction.options.getString('titre');
      const description = interaction.options.getString('description');
      const colorInput = interaction.options.getString('couleur');
      const footer = interaction.options.getString('pied');
      if (title === null && description === null && colorInput === null && footer === null) return interaction.reply({ embeds: [shopEmbed(guildId)], ephemeral: true });
      const color = parseShopColor(colorInput, shop.color);
      if (color === null) return interaction.reply({ content: 'Couleur invalide. Utilise six caractères hexadécimaux, par exemple 06b6d4 ou #06b6d4.', ephemeral: true });
      if (title !== null) shop.title = title;
      if (description !== null) shop.description = description;
      if (colorInput !== null) shop.color = color;
      if (footer !== null) shop.footer = footer;
      saveDatabase();
      return interaction.reply({ content: '✅ Apparence de la boutique mise à jour.', embeds: [shopEmbed(guildId)] });
    }
    if (command === 'shop-list') return interaction.reply({ embeds: [shopEmbed(guildId)], ephemeral: true });
    const itemId = normalizeItemId(interaction.options.getString('id'));
    if (!itemId) return interaction.reply({ content: 'ID invalide : utilise des lettres, chiffres, tirets ou underscores.', ephemeral: true });
    if (command === 'shop-delete') {
      if (!shop.items[itemId]) return interaction.reply({ content: 'Article introuvable.', ephemeral: true });
      delete shop.items[itemId];
      saveDatabase();
      return interaction.reply({ content: '🗑️ Article **' + itemId + '** supprimé.' });
    }
    if (command === 'shop-create') {
      if (shop.items[itemId]) return interaction.reply({ content: 'Cet ID existe déjà. Utilise /shop-edit pour le modifier.', ephemeral: true });
      const role = interaction.options.getRole('role');
      const stock = parseStock(interaction.options.getString('stock'), -1);
      if (stock === null) return interaction.reply({ content: 'Stock invalide. Mets un nombre, 0 ou illimite.', ephemeral: true });
      shop.items[itemId] = { id: itemId, name: interaction.options.getString('nom'), price: interaction.options.getInteger('prix'), description: interaction.options.getString('description'), stock, emoji: interaction.options.getString('emoji') || '🛍️', category: interaction.options.getString('categorie') || 'Général', roleId: role?.id || null };
      saveDatabase();
      return interaction.reply({ content: '✅ Article **' + itemId + '** ajouté à la boutique.', embeds: [shopEmbed(guildId)] });
    }
    const item = shop.items[itemId];
    if (!item) return interaction.reply({ content: 'Article introuvable.', ephemeral: true });
    const name = interaction.options.getString('nom');
    const price = interaction.options.getInteger('prix');
    const description = interaction.options.getString('description');
    const stockInput = interaction.options.getString('stock');
    const emoji = interaction.options.getString('emoji');
    const category = interaction.options.getString('categorie');
    const role = interaction.options.getRole('role');
    const removeRole = interaction.options.getBoolean('retirer-role') === true;
    const stock = parseStock(stockInput, item.stock);
    if (stock === null) return interaction.reply({ content: 'Stock invalide. Mets un nombre, 0 ou illimite.', ephemeral: true });
    if (name !== null) item.name = name;
    if (price !== null) item.price = price;
    if (description !== null) item.description = description;
    if (stockInput !== null) item.stock = stock;
    if (emoji !== null) item.emoji = emoji;
    if (category !== null) item.category = category;
    if (removeRole) item.roleId = null;
    else if (role) item.roleId = role.id;
    saveDatabase();
    return interaction.reply({ content: '✏️ Article **' + itemId + '** modifié.', embeds: [shopEmbed(guildId)] });
  }

  if (command === 'craps') {
    const bet = interaction.options.getInteger('mise');
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    const roll = () => {
      const one = randomInt(1, 6);
      const two = randomInt(1, 6);
      return { one, two, total: one + two };
    };
    const formatRoll = value => '🎲 **' + value.one + ' + ' + value.two + ' = ' + value.total + '**';
    const first = roll();
    const rolls = [formatRoll(first)];
    let payout = 0;
    let reason = '';
    if ([7, 11].includes(first.total)) {
      payout = bet * 2;
      reason = '7 ou 11 au premier tir : tu gagnes x2 ta mise.';
    } else if ([2, 3, 12].includes(first.total)) {
      reason = '2, 3 ou 12 au premier tir : tu perds ta mise.';
    } else {
      const point = first.total;
      reason = 'Point établi : **' + point + '**. Tu as 3 lancers supplémentaires.';
      let finished = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const next = roll();
        rolls.push('Lancer ' + attempt + ' : ' + formatRoll(next));
        if (next.total === point) {
          payout = bet * 4;
          reason += ' Le point est ressorti : gain x4.';
          finished = true;
          break;
        }
        if (next.total === 7) {
          reason += ' Un 7 est sorti : tu perds ta mise.';
          finished = true;
          break;
        }
      }
      if (!finished) {
        payout = bet;
        reason += ' Le point n’est pas ressorti en 3 lancers : mise remboursée.';
      }
    }
    user.wallet -= bet;
    user.wallet += payout;
    saveDatabase();
    return interaction.reply({ content: '🎰 **Craps**\n' + rolls.join(' → ') + '\n' + reason + '\n' + (payout === 0 ? '❌ Tu perds ta mise de **' + money(bet) + '**.' : payout === bet ? '↩️ Mise remboursée.' : '✅ Tu remportes **' + money(payout) + '** !') });
  }

  if (command === 'rps') {
    const bet = interaction.options.getInteger('mise');
    const pick = normalizeChoice(interaction.options.getString('choix'));
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    const choices = ['pierre', 'papier', 'ciseaux'];
    const botPick = choices[randomInt(0, 2)];
    const win = pick === 'pierre' && botPick === 'ciseaux' || pick === 'papier' && botPick === 'pierre' || pick === 'ciseaux' && botPick === 'papier';
    user.wallet -= bet;
    if (pick === botPick) user.wallet += bet;
    else if (win) user.wallet += bet * 2;
    saveDatabase();
    return interaction.reply({ content: '✊ Tu as choisi **' + pick + '**, le bot a choisi **' + botPick + '**. ' + (pick === botPick ? 'Égalité, mise remboursée.' : win ? 'Tu gagnes **' + money(bet * 2) + '** !' : 'Tu perds ta mise.') });
  }

  if (command === 'higherlower') {
    const bet = interaction.options.getInteger('mise');
    const pick = normalizeChoice(interaction.options.getString('choix'));
    if (bet > user.wallet) return interaction.reply({ content: "Tu n'as pas assez de coins dans ton portefeuille.", ephemeral: true });
    const first = randomInt(1, 13);
    const next = randomInt(1, 13);
    user.wallet -= bet;
    const win = pick === 'haut' && next > first || pick === 'bas' && next < first;
    const tie = next === first;
    const payout = tie ? bet : win ? bet * 2 : 0;
    user.wallet += payout;
    saveDatabase();
    return interaction.reply({ content: '🃏 Carte : **' + first + '** → suivante : **' + next + '**. ' + (tie ? 'Égalité, mise remboursée.' : win ? 'Bien vu ! Tu gagnes **' + money(payout) + '**.' : 'Raté, ta mise est perdue.') });
  }



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
    const game = { bet, deck: newDeck(), dealer: [], hands: [{ cards: [], bet, finished: false }], activeHand: 0 };
    const hand = game.hands[0];
    hand.cards.push(game.deck.pop(), game.deck.pop());
    game.dealer.push(game.deck.pop(), game.deck.pop());
    guild.blackjack[userId] = game;
    const playerScore = handValue(hand.cards);
    const dealerScore = handValue(game.dealer);
    if (playerScore === 21 && dealerScore === 21) {
      user.wallet += bet;
      delete guild.blackjack[userId];
      saveDatabase();
      return interaction.reply({ content: "🃏\n" + blackjackText(game, true) + "\nBlackjacks des deux côtés : égalité, mise remboursée." });
    }
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
    return interaction.reply({ content: "🃏\n" + blackjackText(game, false) + "\nUtilise /hit, /stand, /split ou /double." });
  }

  if (command === "hit") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return interaction.reply({ content: "Tu n'as pas de blackjack en cours. Lance /blackjack.", ephemeral: true });
    const hand = currentBlackjackHand(game);
    if (!hand || hand.finished) return interaction.reply({ content: "Cette main est déjà terminée.", ephemeral: true });
    hand.cards.push(game.deck.pop());
    if (handValue(hand.cards) > 21) hand.finished = true;
    if (hand.finished && advanceBlackjackHand(game)) {
      saveDatabase();
      return interaction.reply({ content: "🃏\n" + blackjackText(game, false) + "\nMain dépassée ou terminée. À toi de jouer avec la main suivante : /hit ou /stand." });
    }
    if (hand.finished) {
      const result = settleBlackjack(guildId, userId);
      return interaction.reply({ content: "🃏\n" + blackjackText(game, true) + "\nTu dépasses 21. Partie perdue." + (result.payout ? "\nGain : **" + money(result.payout) + "**." : "") });
    }
    saveDatabase();
    return interaction.reply({ content: "🃏\n" + blackjackText(game, false) + "\n/hit, /stand ou /double ?" });
  }

  if (command === "stand") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return interaction.reply({ content: "Tu n'as pas de blackjack en cours. Lance /blackjack.", ephemeral: true });
    const hand = currentBlackjackHand(game);
    if (!hand || hand.finished) return interaction.reply({ content: "Cette main est déjà terminée.", ephemeral: true });
    hand.finished = true;
    if (advanceBlackjackHand(game)) {
      saveDatabase();
      return interaction.reply({ content: "🃏\n" + blackjackText(game, false) + "\nMain terminée. Joue maintenant la main suivante : /hit ou /stand." });
    }
    const result = settleBlackjack(guildId, userId);
    const outcome = result.results.map((value, index) => "Main " + (index + 1) + " : " + (value === "win" ? "gagnée" : value === "tie" ? "égalité" : "perdue")).join("\n");
    return interaction.reply({ content: "🃏\n" + blackjackText(game, true) + "\n" + outcome + (result.payout ? "\nGain : **" + money(result.payout) + "**." : "\nAucun gain cette fois.") });
  }

  if (command === "split") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return interaction.reply({ content: "Tu n'as pas de blackjack en cours. Lance /blackjack.", ephemeral: true });
    const hands = blackjackHands(game);
    const hand = currentBlackjackHand(game);
    if (hands.length !== 1 || !hand || hand.cards.length !== 2 || hand.cards[0].rank !== hand.cards[1].rank) return interaction.reply({ content: "Tu peux utiliser /split uniquement avec deux cartes de même rang, au début de la main.", ephemeral: true });
    if (hand.bet > user.wallet) return interaction.reply({ content: "Il te faut une deuxième mise identique pour séparer cette paire.", ephemeral: true });
    user.wallet -= hand.bet;
    const first = { cards: [hand.cards[0], game.deck.pop()], bet: hand.bet, finished: false };
    const second = { cards: [hand.cards[1], game.deck.pop()], bet: hand.bet, finished: false };
    game.hands = [first, second];
    game.activeHand = 0;
    saveDatabase();
    return interaction.reply({ content: "✂️ Paire séparée !\n" + blackjackText(game, false) + "\nJoue la main 1 avec /hit ou /stand." });
  }

  if (command === "double") {
    const guild = guildData(guildId);
    const game = guild.blackjack[userId];
    if (!game) return interaction.reply({ content: "Tu n'as pas de blackjack en cours. Lance /blackjack.", ephemeral: true });
    const hand = currentBlackjackHand(game);
    if (!hand || hand.finished || hand.cards.length !== 2) return interaction.reply({ content: "Tu peux doubler uniquement avec deux cartes au début d'une main.", ephemeral: true });
    if (hand.bet > user.wallet) return interaction.reply({ content: "Il te faut assez de coins pour doubler cette mise.", ephemeral: true });
    user.wallet -= hand.bet;
    hand.bet *= 2;
    hand.cards.push(game.deck.pop());
    hand.finished = true;
    if (advanceBlackjackHand(game)) {
      saveDatabase();
      return interaction.reply({ content: "⏫ Mise doublée et une carte tirée.\n" + blackjackText(game, false) + "\nJoue la main suivante : /hit ou /stand." });
    }
    const result = settleBlackjack(guildId, userId);
    const outcome = result.results.map((value, index) => "Main " + (index + 1) + " : " + (value === "win" ? "gagnée" : value === "tie" ? "égalité" : "perdue")).join("\n");
    return interaction.reply({ content: "⏫\n" + blackjackText(game, true) + "\n" + outcome + (result.payout ? "\nGain : **" + money(result.payout) + "**." : "\nAucun gain cette fois.") });
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
