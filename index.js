const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');

// Express Web Sunucusu (Render'ın uygulamayı açık tutması ve oyun içi istekler için)
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Legends Bot 7/24 Aktif!');
});

app.listen(PORT, () => {
  console.log(`Web sunucusu ${PORT} portunda çalışıyor.`);
});

// Discord Bot Kurulumu
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Geçici kod veritabanı (Bellekte tutulur)
// { "DISCORD_ID": { code: "123456", expires: Timestamp } }
const pendingCodes = new Map();
// { "DISCORD_ID": { guestId: "Guest_A1B2C", rank: "Pro" } }
const linkedAccounts = new Map();

// Slash Komut Tanımlamaları
const commands = [
  new SlashCommandBuilder()
    .setName('kod-al')
    .setDescription('Oyunda hesabınızı doğrulamak için 6 haneli geçici kod üretir.'),
  
  new SlashCommandBuilder()
    .setName('dogrula')
    .setDescription('Oyunda aldığınız doğrulama kodunu girerek hesabınızı eşleyin.')
    .addStringOption(option =>
      option.setName('kod')
        .setDescription('6 haneli doğrulama kodu')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('durum')
    .setDescription('Hesabınızın bağlı olduğu Oyuncu ID si ve rütbe bilgisini gösterir.')
].map(command => command.toJSON());

// Bot Hazır Olduğunda
client.once('ready', async () => {
  console.log(`Bot ${client.user.tag} olarak giriş yaptı!`);

  // Slash Komutlarını Discord'a Kaydetme
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Slash komutları yükleniyor...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Slash komutları başarıyla yüklendi!');
  } catch (error) {
    console.error('Komut yükleme hatası:', error);
  }
});

// Slash Komut Etkileşimleri
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, guild, member } = interaction;

  // /kod-al Komutu
  if (commandName === 'kod-al') {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pendingCodes.set(user.id, {
      code: code,
      expires: Date.now() + 10 * 60 * 1000 // 10 Dakika geçerli
    });

    const embed = new EmbedBuilder()
      .setColor('#FFFF55')
      .setTitle('🛡️ Legends Doğrulama Kodu')
      .setDescription(`Doğrulama kodunuz: **${code}**\n\nBu kodu oyundaki doğrulama ekranına girerek hesabınızı bağlayabilirsiniz.\n*Kod 10 dakika boyunca geçerlidir.*`)
      .setFooter({ text: 'Legends Eşitleme Sistemi' });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /dogrula Komutu
  if (commandName === 'dogrula') {
    const inputCode = interaction.options.getString('kod');
    const pendingData = pendingCodes.get(user.id);

    if (!pendingData) {
      return interaction.reply({ content: '❌ Aktif bir doğrulama kodunuz bulunmuyor. Önce `/kod-al` komutunu kullanın.', ephemeral: true });
    }

    if (Date.now() > pendingData.expires) {
      pendingCodes.delete(user.id);
      return interaction.reply({ content: '⚠️ Doğrulama kodunun süresi dolmuş. Lütfen `/kod-al` ile yeni bir kod alın.', ephemeral: true });
    }

    if (pendingData.code !== inputCode) {
      return interaction.reply({ content: '❌ Girdiğiniz kod hatalı! Lütfen tekrar kontrol edin.', ephemeral: true });
    }

    // Kod Doğru
    pendingCodes.delete(user.id);
    const mockGuestId = `Guest_${user.id.slice(-5)}`;
    
    linkedAccounts.set(user.id, {
      guestId: mockGuestId,
      rank: 'Player'
    });

    const embed = new EmbedBuilder()
      .setColor('#55FF55')
      .setTitle('✅ Hesap Başarıyla Bağlandı!')
      .setDescription(`Discord hesabınız **${mockGuestId}** oyuncu ID'si ile eşleştirildi.`)
      .setFooter({ text: 'Legends Role Sync' });

    return interaction.reply({ embeds: [embed] });
  }

  // /durum Komutu
  if (commandName === 'durum') {
    const accountData = linkedAccounts.get(user.id);

    if (!accountData) {
      return interaction.reply({ content: 'ℹ️ Henüz bağlı bir hesabınız yok. `/kod-al` komutu ile eşleştirme yapabilirsiniz.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#55FFFF')
      .setTitle('📊 Legends Profil Durumu')
      .addFields(
        { name: 'Oyuncu ID', value: `\`${accountData.guestId}\``, inline: true },
        { name: 'Mevcut Rütbe', value: `**${accountData.rank}**`, inline: true }
      )
      .setFooter({ text: 'Legends Eşitleme Sistemi' });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// Oyun İçi API Uç Noktası (Oyun Rütbe Güncellediğinde Çağrılır)
app.post('/api/sync-role', async (req, res) => {
  const { discordId, rank } = req.body;

  if (!discordId || !rank) {
    return res.status(400).json({ error: 'Eksik parametre.' });
  }

  try {
    const guild = client.guilds.cache.first(); // Botun olduğu ilk sunucuyu alır
    if (!guild) return res.status(500).json({ error: 'Sunucu bulunamadı.' });

    const member = await guild.members.fetch(discordId);
    if (!member) return res.status(404).json({ error: 'Kullanıcı sunucuda bulunamadı.' });

    // Verilen rank ismine uygun Discord Rolünü Bulma
    const targetRole = guild.roles.cache.find(r => r.name.toLowerCase() === rank.toLowerCase());
    
    if (targetRole) {
      // Eski rütbe rollerini temizleyip yenisini verme örneği
      const rankRoles = ['Pro', 'Legend', 'Immortal', 'Admin'];
      const rolesToRemove = guild.roles.cache.filter(r => rankRoles.includes(r.name));
      
      await member.roles.remove(rolesToRemove);
      await member.roles.add(targetRole);

      return res.json({ success: true, message: `${member.user.tag} kullanıcısına ${rank} rolü verildi.` });
    } else {
      return res.status(404).json({ error: `Sunucuda '${rank}' adında bir rol bulunamadı.` });
    }
  } catch (error) {
    console.error('Rol senkronizasyon hatası:', error);
    return res.status(500).json({ error: 'Rol güncellenirken bir hata oluştu.' });
  }
});

// Bota Bağlan
client.login(process.env.DISCORD_TOKEN);
