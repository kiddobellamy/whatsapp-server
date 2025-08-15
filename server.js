import express from 'express';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, RemoteAuth } = pkg;
import pkgPg from 'pg';
const { Pool } = pkgPg;

const app = express();
app.use(express.json());

// Variables globales
let qrCodeData = null;
let clientStatus = 'INITIALIZING';
let lastStatusUpdate = new Date().toISOString();

// Configuración de PostgreSQL / Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_FwNutc2nlxo3@ep-empty-star-aeqb2pfu-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

// Crear tabla si no existe
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
          id INTEGER PRIMARY KEY DEFAULT 1,
          session_data TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla de sesiones inicializada');
  } catch (err) {
    console.error('❌ Error inicializando base de datos:', err);
  }
}

// Custom RemoteAuth store para PostgreSQL
class PostgreSQLStore {
  async sessionExists(options) {
    try {
      const result = await pool.query('SELECT session_data FROM whatsapp_sessions WHERE id = 1');
      const exists = result.rows.length > 0 && result.rows[0].session_data;
      console.log(`🔍 Sesión existe: ${exists ? 'SÍ' : 'NO'}`);
      return exists;
    } catch (err) {
      console.error('❌ Error verificando sesión:', err);
      return false;
    }
  }

  async extract(options) {
    try {
      const result = await pool.query('SELECT session_data FROM whatsapp_sessions WHERE id = 1');
      if (result.rows.length > 0 && result.rows[0].session_data) {
        const sessionData = JSON.parse(result.rows[0].session_data);
        console.log('✅ Sesión cargada desde base de datos');
        return sessionData;
      }
      return null;
    } catch (err) {
      console.error('❌ Error cargando sesión:', err);
      return null;
    }
  }

  async save(options) {
    try {
      const sessionString = JSON.stringify(options);
      await pool.query(
        `
        INSERT INTO whatsapp_sessions (id, session_data, updated_at)
        VALUES (1, $1, NOW())
        ON CONFLICT (id) DO UPDATE
        SET session_data = EXCLUDED.session_data,
            updated_at = NOW()
        `,
        [sessionString]
      );
      console.log('✅ Sesión guardada en base de datos');
    } catch (err) {
      console.error('❌ Error guardando sesión:', err);
    }
  }

  async delete(options) {
    try {
      await pool.query('DELETE FROM whatsapp_sessions WHERE id = 1');
      console.log('🗑️ Sesión eliminada');
    } catch (err) {
      console.error('❌ Error eliminando sesión:', err);
    }
  }
}

// Configuración del cliente de WhatsApp con RemoteAuth
const store = new PostgreSQLStore();
const client = new Client({
  authStrategy: new RemoteAuth({
    store: store,
    backupSyncIntervalMs: 300000 // Backup cada 5 minutos
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

// Event handlers
client.on('qr', async (qr) => {
  console.log('📱 Código QR generado - Escanea con WhatsApp');
  clientStatus = 'QR_GENERATED';
  lastStatusUpdate = new Date().toISOString();
  
  try {
    qrCodeData = await qrcode.toDataURL(qr);
    console.log('✅ QR convertido a imagen');
  } catch (err) {
    console.error('❌ Error generando QR:', err);
  }
});

client.on('authenticated', () => {
  console.log('🔐 Cliente autenticado correctamente');
  clientStatus = 'AUTHENTICATED';
  lastStatusUpdate = new Date().toISOString();
});

client.on('auth_failure', (msg) => {
  console.error('❌ Fallo de autenticación:', msg);
  clientStatus = 'AUTH_FAILED';
  lastStatusUpdate = new Date().toISOString();
  qrCodeData = null;
});

client.on('ready', () => {
  console.log('🚀 WhatsApp Web está listo y conectado!');
  clientStatus = 'READY';
  lastStatusUpdate = new Date().toISOString();
  qrCodeData = null; // Limpiamos el QR una vez conectado
});

client.on('loading_screen', (percent, message) => {
  console.log(`⏳ Cargando WhatsApp: ${percent}% - ${message}`);
  clientStatus = `LOADING_${percent}`;
  lastStatusUpdate = new Date().toISOString();
});

client.on('disconnected', (reason) => {
  console.log('❌ Cliente desconectado:', reason);
  clientStatus = 'DISCONNECTED';
  lastStatusUpdate = new Date().toISOString();
  
  // Intentar reconectar después de 10 segundos
  setTimeout(() => {
    console.log('🔄 Intentando reconectar...');
    client.initialize();
  }, 10000);
});

client.on('message', (msg) => {
  console.log(`📨 Mensaje de ${msg.from}: ${msg.body}`);
});

client.on('remote_session_saved', () => {
  console.log('💾 Sesión remota guardada');
});

// Rutas del servidor
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Server Status</title>
        <meta http-equiv="refresh" content="5">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto; }
            .status { padding: 15px; border-radius: 5px; margin: 20px 0; }
            .ready { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .loading { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
            .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            .qr { background: #cce5ff; color: #004085; border: 1px solid #99ccff; }
            img { max-width: 100%; height: auto; margin: 20px 0; }
            .info { margin: 10px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 WhatsApp Server</h1>
            <div class="status ${getStatusClass(clientStatus)}">
                <strong>Estado:</strong> ${getStatusMessage(clientStatus)}
            </div>
            <div class="info">
                <strong>Última actualización:</strong> ${lastStatusUpdate}
            </div>
            ${qrCodeData ? `
                <div class="qr">
                    <h3>📱 Escanea este código QR con WhatsApp:</h3>
                    <img src="${qrCodeData}" alt="QR Code"/>
                    <p><em>La página se actualiza automáticamente cada 5 segundos</em></p>
                </div>
            ` : ''}
            <hr>
            <h3>📡 Endpoints disponibles:</h3>
            <ul>
                <li><code>POST /send-message</code> - Enviar mensaje</li>
                <li><code>GET /status</code> - Estado del cliente</li>
                <li><code>POST /logout</code> - Cerrar sesión</li>
            </ul>
        </div>
    </body>
    </html>
  `;
  res.send(html);
});

function getStatusClass(status) {
  if (status === 'READY') return 'ready';
  if (status.includes('LOADING') || status === 'AUTHENTICATED') return 'loading';
  if (status === 'QR_GENERATED') return 'qr';
  return 'error';
}

function getStatusMessage(status) {
  const messages = {
    'INITIALIZING': '🔄 Inicializando...',
    'QR_GENERATED': '📱 Código QR generado - Escanea con WhatsApp',
    'AUTHENTICATED': '🔐 Autenticado - Cargando...',
    'READY': '✅ Conectado y listo',
    'AUTH_FAILED': '❌ Error de autenticación',
    'DISCONNECTED': '❌ Desconectado'
  };
  
  if (status.includes('LOADING')) {
    return `⏳ Sincronizando WhatsApp (${status.replace('LOADING_', '')}%)`;
  }
  
  return messages[status] || status;
}

// Ruta para estado del cliente
app.get('/status', (req, res) => {
  res.json({
    status: clientStatus,
    lastUpdate: lastStatusUpdate,
    hasQR: !!qrCodeData,
    isReady: clientStatus === 'READY'
  });
});

// Ruta para enviar mensaje
app.post('/send-message', async (req, res) => {
  if (clientStatus !== 'READY') {
    return res.status(503).json({ 
      error: 'WhatsApp no está listo',
      status: clientStatus
    });
  }

  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ 
      error: 'Número y mensaje son requeridos',
      example: { number: '1234567890', message: 'Hola mundo' }
    });
  }

  try {
    // Formatear número
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    
    // Enviar mensaje
    await client.sendMessage(chatId, message);
    
    console.log(`📤 Mensaje enviado a ${number}: ${message}`);
    res.json({ 
      success: true,
      message: 'Mensaje enviado correctamente',
      to: number
    });
  } catch (err) {
    console.error('❌ Error enviando mensaje:', err);
    res.status(500).json({ 
      error: 'Error enviando mensaje',
      details: err.message
    });
  }
});

// Ruta para cerrar sesión
app.post('/logout', async (req, res) => {
  try {
    await client.logout();
    clientStatus = 'DISCONNECTED';
    lastStatusUpdate = new Date().toISOString();
    qrCodeData = null;
    
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check para Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    whatsappStatus: clientStatus,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`🌐 Servidor ejecutándose en puerto ${PORT}`);
  
  // Inicializar base de datos
  await initDatabase();
  
  // Inicializar WhatsApp
  console.log('🔄 Inicializando cliente de WhatsApp...');
  client.initialize();
});

// Manejo graceful de shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Cerrando servidor...');
  await client.destroy();
  await pool.end();
  process.exit(0);
});
