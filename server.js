const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const { Client } = require('whatsapp-web.js');

const SESSION_FILE_PATH = './whatsapp-session.json';
let sessionData;
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionData = require(SESSION_FILE_PATH);
}

const client = new Client({
    session: sessionData
});

const app = express();
app.use(express.json());

// Variable para guardar el último QR generado
let latestQRCode = null;

client.on('qr', async (qr) => {
    latestQRCode = qr; // Guardamos el QR para mostrarlo en web
    console.log('QR generado en consola');
});

client.on('authenticated', (session) => {
    fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(session));
    console.log('Sesión guardada!');
});

client.on('ready', () => {
    console.log('WhatsApp listo!');
});

client.initialize();

// Endpoint para enviar mensajes
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

// Página web para mostrar QR
app.get('/', async (req, res) => {
    if (latestQRCode) {
        const qrImage = await qrcode.toDataURL(latestQRCode);
        res.send(`
            <h2>Escanea este QR con WhatsApp Web</h2>
            <img src="${qrImage}" />
        `);
    } else if (client.info && client.info.me) {
        res.send('<h2>WhatsApp listo ✅</h2>');
    } else {
        res.send('<h2>Esperando QR...</h2>');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
