require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { hm, sys, inf, kuroi, warn, erro } = require('./tosh/system/logs.js');
const ai = require('./tosh/assets/ai.js');
const config = require('./config.json');
global.config = config;

if (!global.config.token) {
    erro('Telegram bot token is not defined in the configuration.');
    process.exit(1);
}

global.client = {
    commands: new Map(),
    reactions: new Map()
};

global.data = {
    groups: {},
    allThreads: null,
};

const bot = new TelegramBot(global.config.token, { polling: true });
(async () => {
    try {
        const data = await bot.getMe();
        inf("Bot Information");
        inf(`Name: ${data.first_name}`);
        inf(`ID: ${data.id}`);
        inf(`Username: @${data.username}`);
        global.botUsername = data.username;
        inf(`Owner: ${global.config.owner}`);
        await loadScripts();
    } catch (err) {
        erro('Invalid Telegram bot token. Please check your configuration.');
        process.exit(1);
    }
})();

const commandsFolder = path.join(__dirname, './commands');
const cacheDirectory = path.join(__dirname, './commands/cache');
const databaseFilePath = path.join(__dirname, './tosh/database/group.json');

if (!fs.existsSync(databaseFilePath)) {
    fs.mkdirSync(path.dirname(databaseFilePath), { recursive: true });
    fs.writeFileSync(databaseFilePath, JSON.stringify({}, null, 4));
}

if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory, { recursive: true });
}

const loadGroups = () => {
    global.data.groups = JSON.parse(fs.readFileSync(databaseFilePath, 'utf-8'));
};

const saveGroups = () => {
    fs.writeFileSync(databaseFilePath, JSON.stringify(global.data.groups, null, 4));
};

const addGroup = (groupId) => {
    if (!global.data.groups[groupId]) {
        global.data.groups[groupId] = { ai: true, bot: true, meme: true, noti: true };
        saveGroups();
        sys(`Added new group with ID ${groupId} to database.`);
    }
};

loadGroups();

const figlet = require('figlet');

figlet('tosh', (err, data) => {
    if (err) {
        erro('Error generating figlet:', err);
        return;
    }
    kuroi(data);


    const server = require('./tosh/system/server.js');
    
});

const loadScripts = async () => {
    const scripts = {}; 
    let commandCount = 0;

    fs.readdirSync(commandsFolder).forEach(file => {
        if (file.endsWith('.js')) {
            commandCount++;
            const script = require(path.join(commandsFolder, file));
            const { config } = script;

            if (!config || !config.name || !config.description || !config.access || !config.author || !config.category) {
                warn(`Invalid command file: ${file}`);
                return;
            }

            scripts[config.name.toLowerCase()] = script;
            if (config.aliases && Array.isArray(config.aliases)) {
                config.aliases.forEach(alias => {
                    scripts[alias.toLowerCase()] = script;
                });
            }

            global.client.commands.set(config.name.toLowerCase(), script);
            if (config.aliases && Array.isArray(config.aliases)) {
                config.aliases.forEach(alias => {
                    global.client.commands.set(alias.toLowerCase(), script);
                });
            }
        }
    });

    try {
        await bot.setMyCommands(Object.values(scripts).map(({ config }) => ({ command: config.name, description: config.description })));
    } catch (err) {
        erro('Error setting bot commands:', err);
    }

    inf(`Commands: ${commandCount}`);
};

const hasAccess = async (accessLevel, chat, userId, commandName) => {
    if (accessLevel === 'anyone') return { hasAccess: true };

    if (accessLevel === 'admin') {
        const chatAdmins = await bot.getChatAdministrators(chat.id);
        const isAdmin = chatAdmins.some(admin => admin.user.id === userId);
        if (!isAdmin) {
            return { hasAccess: false, message: `You don't have permission to use ${commandName}. Only group admins can use it.` };
        }
        return { hasAccess: true };
    }

    if (accessLevel === 'operator') {
        if (userId !== global.config.owner_uid) {
            return { hasAccess: false, message: `You don't have permission to use ${commandName}. Only ${global.config.owner} can use it.` };
        }
        return { hasAccess: true };
    }

    return { hasAccess: false, message: `Invalid access level for command ${commandName}.` };
};

const findClosestCommand = (inputCommand) => {
    const commandNames = Array.from(global.client.commands.keys());
    let closestCommand = null;
    let minDistance = Infinity;

    commandNames.forEach(cmd => {
        const distance = levenshteinDistance(inputCommand, cmd);
        if (distance < minDistance) {
            minDistance = distance;
            closestCommand = cmd;
        }
    });

    return closestCommand;
};

const levenshteinDistance = (a, b) => {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, 
                    matrix[i][j - 1] + 1, 
                    matrix[i - 1][j] + 1 
                );
            }
        }
    }

    return matrix[b.length][a.length];
};

bot.on('message', async (msg) => {
    const { chat, from, text } = msg;
    const { id: chatId, type: chatType } = chat;
    const { id: userId } = from;

    if (chatType === 'group' || chatType === 'supergroup') {
        addGroup(chatId);
    }

    if (global.data.groups[chatId] && !global.data.groups[chatId].bot) {

        if (!text.startsWith('/group')) return;
    }

    if (typeof text === 'string' && text.startsWith('/')) {
        let [command, ...args] = text.slice(1).split(' ');

        if (command.includes('@')) {
            const [cmd, commandUsername] = command.split('@');
            if (!commandUsername || commandUsername.toLowerCase() !== global.botUsername.toLowerCase()) return;
            command = cmd;
        }

        if (command.length === 0) {
            bot.sendMessage(chatId, 'You typed only the prefix. Please provide a command. Type /help all to view all commands.');
            return;
        }

        const script = global.client.commands.get(command.toLowerCase());
        if (script) {
            hm(`The command '${command}' was used in the group ${chatId}`);
            const { name, usage, access } = script.config;
            const formattedUsage = Array.isArray(usage) ? usage.map(u => `/${name} ${u}`).join('\n') : `/${name} ${usage}`;
            const usages = () => bot.sendMessage(chatId, `⦿ Usages:\n${formattedUsage}`);

            const accessResult = await hasAccess(access, chat, userId, name);

            if (!accessResult.hasAccess) {
                bot.sendMessage(chatId, accessResult.message);
                return;
            }

            try {
                await script.initialize({ bot, chatId, userId, args, msg, usages });
                saveGroups(); 
            } catch (err) {
                erro(`Error executing command '${name}':`, err);
                bot.sendMessage(chatId, 'An error occurred while executing the command.');
            } finally {
                deleteCache();
            }
        } else {
            const closestCommand = findClosestCommand(command.toLowerCase());
            bot.sendMessage(chatId, `The command '${command}' is not found in my system. Did you mean '${closestCommand}'?`);
        }
    } else if (typeof text === 'string') {
        if (chatType === 'private' || (global.data.groups[chatId] && global.data.groups[chatId].ai)) {
            try {
                const aiResponse = await ai.getAIResponse(text, chatType);
                if (aiResponse) bot.sendMessage(chatId, aiResponse);
            } catch (err) {
                erro('Error getting AI response:', err);
                bot.sendMessage(chatId, 'An error occurred while processing your message.');
            }
        }
    }
});

const assets = {
    noti: './tosh/assets/noti.js',
    meme: './tosh/assets/meme.js'
};

for (const assetPath of Object.values(assets)) {
    require(assetPath)(bot);
}

process.on('SIGINT', async () => {
    inf('Shutting down bot...');
    try {
        await bot.stopPolling();
        inf('Bot stopped polling');
        process.exit(0);
    } catch (err) {
        erro('Error stopping bot:', err);
        process.exit(1);
    }
});

const deleteCache = () => {
    fs.readdirSync(cacheDirectory).forEach(file => {
        const filePath = path.join(cacheDirectory, file);
        fs.unlinkSync(filePath);
        hm(`Deleted cache file: ${filePath}`);
    });
};
