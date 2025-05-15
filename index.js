const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  Routes,
  REST,
  Events,
  Partials,
  StringSelectMenuBuilder,
} = require('discord.js');
const cron = require('node-cron');
const dayjs = require('dayjs');
require('dayjs/locale/ja');
dayjs.locale('ja');
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_USER_ID = process.env.TARGET_USER_ID;

const schedule = require('./schedule');
const getWeather = require('./getWeather');
const getUpcomingTasks = require('./getNotionTasks');
const { saveTaskToNotion } = require('./saveTaskToNotion');
const { getFormattedNews } = require('./news');
const timetable = require('./timetable');

const pendingTasks = new Map();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

const buildMessage = async (prefix = 'おはようございます') => {
  const today = dayjs().add(9, 'hour');
  const dayLabel = today.format('dd');
  const todaySchedule = schedule[dayLabel] || ['（時間割未登録）'];
  const scheduleText = todaySchedule.join('\n');
  const weather = await getWeather();
  const taskText = await getUpcomingTasks();

  return `${prefix}！今日は ${today.format('MM月DD日（dd）')} です！\n\n` +
    `${weather ? `🌤️ 天気：${weather.description}\n🌡️ 気温：最高 ${weather.tempMax}℃ / 最低 ${weather.tempMin}℃` : '🌥️ 天気情報を取得できませんでした。'}\n\n` +
    `📚 今日の時間割:\n${scheduleText}\n\n${taskText}`;
};
client.once('ready', async () => {
  console.log(`✅ Bot started as ${client.user.tag}`);

  const user = await client.users.fetch(TARGET_USER_ID);
  const message = await buildMessage('✅ テスト送信');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('go').setLabel('GO').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('back').setLabel('BACK').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('add_task').setLabel('📝 タスクを追加').setStyle(ButtonStyle.Success)
  );

  await user.send({ content: message, components: [row] });
});

// 通学・タスク通知（毎朝6時）
cron.schedule('0 6 * * *', async () => {
  const user = await client.users.fetch(TARGET_USER_ID);
  const message = await buildMessage();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('go').setLabel('GO').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('back').setLabel('BACK').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('add_task').setLabel('📝 タスクを追加').setStyle(ButtonStyle.Success)
  );

  await user.send({ content: message, components: [row] });
});
// ニュース通知（朝・昼・夜）
const sendNews = async (label) => {
  const user = await client.users.fetch(TARGET_USER_ID);
  const now = dayjs().add(9, 'hour').format('MM/DD HH:mm');
  try {
    const news = await getFormattedNews(label);
    await user.send(`📰【${label}のニュース】（${now}）\n\n${news}`);
  } catch (e) {
    console.error(`❌ ${label}ニュース取得エラー:`, e);
    await user.send(`📰【${label}のニュース】（${now}）\n⚠️ ニュースの取得に失敗しました。`);
  }
};

cron.schedule('0 7 * * *', () => sendNews('朝'));
cron.schedule('0 12 * * *', () => sendNews('昼'));
cron.schedule('0 20 * * *', () => sendNews('夜'));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'go' || interaction.customId === 'back') {
        await interaction.deferReply({ ephemeral: true });
        const now = dayjs().add(9, 'hour');
        const nowMinutes = now.hour() * 60 + now.minute();

        const isGo = interaction.customId === 'go';
        const timetableList = isGo ? timetable.weekday.go : timetable.weekday.back;

        const upcoming = timetableList
          .map(time => {
            const [h, m] = time.split(':').map(Number);
            return { time, minutes: h * 60 + m };
          })
          .filter(entry => entry.minutes >= nowMinutes)
          .slice(0, 2);

        let reply = `【${isGo ? '通学（福工大前 → 二日市）' : '帰宅（二日市 → 福工大前）'}案内】\n`;

        if (upcoming.length === 0) {
          reply += '本日の運行は終了しています。';
        } else {
          upcoming.forEach((entry, idx) => {
            reply += `\n${idx + 1}. 出発時刻：${entry.time}`;
          });
        }

        await interaction.editReply({ content: reply });
      }
      if (interaction.customId === 'add_task') {
        const modal = new ModalBuilder().setCustomId('task_modal').setTitle('タスクを追加');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('task_name')
              .setLabel('タスク名')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('task_deadline')
              .setLabel('期限 (YYYY-MM-DD または YYYYMMDD)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('task_description')
              .setLabel('内容')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
          )
        );
        await interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'task_modal') {
      let title = interaction.fields.getTextInputValue('task_name');
      let deadline = interaction.fields.getTextInputValue('task_deadline');
      const description = interaction.fields.getTextInputValue('task_description');

      if (/^\d{8}$/.test(deadline)) {
        deadline = `${deadline.slice(0, 4)}-${deadline.slice(4, 6)}-${deadline.slice(6, 8)}`;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
        await interaction.reply({ content: '⚠️ 期限の形式が不正です。YYYYMMDD または YYYY-MM-DD で入力してください。', ephemeral: true });
        return;
      }

      const uuid = uuidv4();
      pendingTasks.set(uuid, { title, deadline, description });

      const select = new StringSelectMenuBuilder()
        .setCustomId(`task_type_select|${uuid}`)
        .setPlaceholder('タスクの種類を選んでください')
        .addOptions([
          { label: 'To Do', value: 'To Do' },
          { label: 'Assignment', value: 'Assignment' },
          { label: 'Test', value: 'Test' },
          { label: 'Others', value: 'Others' }
        ]);

      const row = new ActionRowBuilder().addComponents(select);
      await interaction.reply({ content: '🔽 タスクの種類を選んでください：', components: [row], ephemeral: true });
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('task_type_select')) {
      const [, uuid] = interaction.customId.split('|');
      const task = pendingTasks.get(uuid);
      if (!task) {
        await interaction.reply({ content: '⚠️ タスク情報が見つかりませんでした。', ephemeral: true });
        return;
      }

      const type = interaction.values[0];
      const result = await saveTaskToNotion({
        title: task.title,
        deadline: task.deadline,
        type,
        description: task.description,
      });

      pendingTasks.delete(uuid);

      await interaction.update({
        content: result.success
          ? '✅ タスクをNotionに追加しました！'
          : '❌ タスクの追加に失敗しました。',
        components: [],
      });
    }
  } catch (e) {
    console.error('❌ Interaction処理中エラー:', e);
  }
});

const commands = [
  new SlashCommandBuilder()
    .setName('task')
    .setDescription('📝 タスク追加ボタンを表示します'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ スラッシュコマンド登録成功');
  } catch (err) {
    console.error('❌ スラッシュコマンド登録失敗:', err);
  }
})();

const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is running.'));
app.listen(process.env.PORT || 3000);

client.login(TOKEN);
