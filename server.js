import { Client, LocalAuth } from 'whatsapp-web.js';
import express from 'express';
import qrcode from 'qrcode';
import { Pool } from 'pg';

const app = express();
app.use(express.json());

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_FwNutc2nlxo3@ep-empty-star-aeqb2pfu-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

let sessionData = null;

// Inicializa el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'client-one' }),
    puppeteer: { headless: true }
});

client.on('qr', async qr => {
    console.log('QR generado en consola');
    try {
        const qrImage = await qrcode.toDataURL(qr);
        sessionData = { qr: qrImage }; // Guardamos temporalmente
    } catch (err) {
        console.error('Error generando QR', err);
    }
});

client.on('authenticated', async session => {
    console.log('Cliente autenticado ✅');
    sessionData = session;
    await saveSession(sessionData);
});

client.on('ready', async () => {
    console.log('WhatsApp listo ✅');

    if (sessionData && !sessionData.saved) {
        try {
            // Si la sesión no se ha guardado, la guardamos
            await saveSession(sessionData);
            sessionData.saved = true;
        } catch (err) {
            console.error('Error guardando sesión:', err);
        }
    }
});

client.on('auth_failure', msg => {
    console.error('Fallo de autenticación', msg);
});

client.initialize();

// Función para guardar sesión en Neon
async function saveSession(session) {
    if (!session) {
        console.log('No hay datos de sesión para guardar ❌');
        return;
    }

    const query = `
        INSERT INTO whatsapp_sessions (session_data, created_at, updated_at)
        VALUES ($1, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET session_data = EXCLUDED.session_data, updated_at = NOW()
    `;

    try {
        await pool.query(query, [JSON.stringify(session)]);
        console.log('Sesión guardada en Neon ✅');
    } catch (err) {
        console.error('Error guardando sesión en Neon:', err);
    }
}

// Endpoint para enviar mensajes
app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'Número y mensaje son requeridos' });

    try {
        const chat = await client.getChatById(`${number}@c.us`);
        await chat.sendMessage(message);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para mostrar QR si no hay sesión
app.get('/', async (req, res) => {
    if (sessionData?.qr) {
        res.send(`<img src="${sessionData.qr}" alt="QR Code" />`);
    } else {
        res.send('WhatsApp conectado ✅');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
