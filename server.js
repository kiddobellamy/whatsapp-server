const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');

const SESSION_FILE_PATH = './whatsapp-session.json';

let sessionData;
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionData = require(SESSION_FILE_PATH);
}

const client = new Client({
    session: sessionData
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea este QR con WhatsApp Web para iniciar sesión');
});

client.on('authenticated', session => {
    fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(session));
    console.log('Sesión guardada!');
});

client.on('ready', () => {
    console.log('WhatsApp listo!');
});

client.initialize();

const app = express();
app.use(bodyParser.json());

app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'Faltan parámetros' });

    try {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
