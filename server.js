const express = require('express');
const qrcode = require('qrcode');
const { Client } = require('whatsapp-web.js');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

let sessionData = null;
let latestQRCode = null;
let isClientReady = false;

// ------------------- Base de datos -------------------
async function loadSession() {
    try {
        const res = await pool.query('SELECT session_data FROM whatsapp_sessions ORDER BY id DESC LIMIT 1');
        if (res.rows.length && res.rows[0].session_data) {
            sessionData = res.rows[0].session_data;
            console.log('Sesión cargada desde Neon ✅');
        }
    } catch (err) {
        console.error('Error cargando sesión desde Neon:', err);
    }
}

async function saveSession(session) {
    if (!session) {
        console.log('No hay datos de sesión para guardar ❌');
        return;
    }
    try {
        await pool.query(
            'INSERT INTO whatsapp_sessions(session_data) VALUES($1)',
            [session]
        );
        console.log('Sesión guardada en Neon ✅');
    } catch (err) {
        console.error('Error guardando sesión en Neon:', err);
    }
}

// ------------------- Cliente WhatsApp -------------------
const client = new Client({ session: sessionData });

client.on('qr', (qr) => {
    latestQRCode = qr;
    console.log('QR generado en consola');
});

client.on('authenticated', async (session) => {
    sessionData = session; // aseguramos que se actualice sessionData
    await saveSession(session);
});

client.on('ready', async () => {
    isClientReady = true;
    console.log('WhatsApp listo ✅');
});

// ------------------- Inicializar -------------------
(async () => {
    await loadSession();
    client.initialize();
})();

// ------------------- Endpoints -------------------

// Enviar mensaje
app.post('/send-message', async (req, res) => {
    if (!isClientReady) return res.status(400).json({ error: 'Cliente WhatsApp no listo' });

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

// Página principal: muestra QR o estado
app.get('/', async (req, res) => {
    if (latestQRCode) {
        const qrImage = await qrcode.toDataURL(latestQRCode);
        res.send(`
            <h2>Escanea este QR con WhatsApp Web</h2>
            <img src="${qrImage}" />
        `);
    } else if (isClientReady) {
        res.send('<h2>WhatsApp listo ✅</h2>');
    } else {
        res.send('<h2>Esperando QR...</h2>');
    }
});

// ------------------- Iniciar servidor -------------------
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
