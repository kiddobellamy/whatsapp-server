import express from 'express';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import pkgPg from 'pg';
const { Pool } = pkgPg;

const app = express();
app.use(express.json());

// Configuración de PostgreSQL / Neon
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_FwNutc2nlxo3@ep-empty-star-aeqb2pfu-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

// Creamos tabla si no existe
await pool.query(`
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id SERIAL PRIMARY KEY,
    session_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
)
`);

// Función para guardar sesión
async function saveSession(session) {
  if (!session) {
    console.log('No hay datos de sesión para guardar ❌');
    return;
  }

  try {
    const sessionString = JSON.stringify(session);
    // Upsert: si ya hay sesión, actualizamos
    await pool.query(
      `INSERT INTO whatsapp_sessions (session_data)
       VALUES ($1)
       ON CONFLICT (id) DO UPDATE SET session_data = EXCLUDED.session_data, updated_at = NOW()`,
      [sessionString]
    );
    console.log('Sesión guardada en Neon ✅');
  } catch (err) {
    console.error('Error guardando sesión:', err);
  }
}

// Configuración del cliente de WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-server' }),
});

client.on('qr', async (qr) => {
  console.log('QR generado en consola');
  try {
    const qrImage = await qrcode.toDataURL(qr);
    // Puedes servirlo en la ruta principal
    app.get('/', (req, res) => {
      res.send(`<img src="${qrImage}"/>`);
    });
  } catch (err) {
    console.error('Error generando QR:', err);
  }
});

client.on('ready', async () => {
  console.log('WhatsApp listo ✅');
  const session = client.authStrategy?.state || null;
  await saveSession(session);
});

client.on('auth_failure', (msg) => {
  console.error('Fallo de autenticación:', msg);
});

client.on('message', (msg) => {
  console.log('Mensaje recibido de', msg.from, ':', msg.body);
});

// Ruta para enviar mensaje
app.post('/send-message', async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) return res.status(400).json({ error: 'Número y mensaje son requeridos' });

  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (err) {
    console.error('Error enviando mensaje:', err);
    res.status(500).json({ error: err.message });
  }
});

// Iniciamos servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

client.initialize();
