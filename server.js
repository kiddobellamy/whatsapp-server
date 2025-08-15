import express from 'express';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import pkgPg from 'pg';
const { Pool } = pkgPg;
import dotenv from 'dotenv';
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Configuración de entorno
dotenv.config();

// Configuración de logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Configuración de rutas ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración de Express
const app = express();
app.use(express.json());

// Middleware de monitorización
app.use(require('express-status-monitor')());

// Configuración de PostgreSQL / Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_FwNutc2nlxo3@ep-empty-star-aeqb2pfu-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: {
    rejectUnauthorized: false
  }
});

// Crear tabla de sesiones si no existe
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id SERIAL PRIMARY KEY,
        session_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    logger.info('Base de datos inicializada correctamente');
  } catch (err) {
    logger.error('Error inicializando base de datos:', err);
    process.exit(1);
  }
}

// Función para guardar sesión mejorada
async function saveSession(session) {
  if (!session) {
    logger.warn('No hay datos de sesión para guardar');
    return;
  }

  try {
    const sessionString = JSON.stringify(session);
    const result = await pool.query(
      `INSERT INTO whatsapp_sessions (id, session_data)
       VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE
       SET session_data = EXCLUDED.session_data,
           updated_at = NOW()
       RETURNING *`,
      [sessionString]
    );
    
    logger.info('Sesión guardada correctamente', { 
      rowsAffected: result.rowCount,
      updatedAt: result.rows[0]?.updated_at 
    });
  } catch (err) {
    logger.error('Error guardando sesión:', err);
    throw err;
  }
}

// Función para cargar sesión
async function loadSession() {
  try {
    const result = await pool.query('SELECT session_data FROM whatsapp_sessions WHERE id = 1');
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].session_data);
    }
    return null;
  } catch (err) {
    logger.error('Error cargando sesión:', err);
    return null;
  }
}

// Configuración del cliente de WhatsApp con manejo mejorado de sesiones
const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: 'whatsapp-server',
    dataPath: path.join(__dirname, 'sessions')
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
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  }
});

// Estado de conexión
let connectionStatus = {
  isConnected: false,
  isAuthenticated: false,
  isSyncing: false,
  lastSync: null
};

// Evento QR mejorado
client.on('qr', async (qr) => {
  connectionStatus.isConnected = false;
  connectionStatus.isAuthenticated = false;
  
  logger.info('QR generado - Esperando escaneo');
  
  try {
    const qrImage = await qrcode.toDataURL(qr);
    app.get('/', (req, res) => {
      res.send(`
        <div style="text-align: center; margin-top: 50px;">
          <h1>WhatsApp Web Server</h1>
          <p>Escanea el siguiente código QR:</p>
          <img src="${qrImage}" style="width: 300px; height: 300px;"/>
          <p>Estado: ${JSON.stringify(connectionStatus, null, 2)}</p>
        </div>
      `);
    });
  } catch (err) {
    logger.error('Error generando QR:', err);
  }
});

// Evento de autenticación
client.on('authenticated', async (session) => {
  connectionStatus.isAuthenticated = true;
  logger.info('Autenticación exitosa');
  await saveSession(session);
});

// Evento de carga de sesión
client.on('loading_screen', (percent, message) => {
  connectionStatus.isSyncing = true;
  logger.info(`Sincronizando: ${percent}% - ${message}`);
});

// Evento ready mejorado
client.on('ready', async () => {
  connectionStatus.isConnected = true;
  connectionStatus.isAuthenticated = true;
  connectionStatus.isSyncing = false;
  connectionStatus.lastSync = new Date();
  
  logger.info('WhatsApp listo y conectado');
  
  // Guardar la sesión
  const session = client.authStrategy?.state || null;
  await saveSession(session);
});

// Evento de cambio de estado
client.on('change_state', (state) => {
  logger.info('Cambio de estado:', state);
  connectionStatus.isConnected = state === 'CONNECTED';
});

// Manejo de desconexión
client.on('disconnected', (reason) => {
  connectionStatus.isConnected = false;
  logger.warn('WhatsApp desconectado:', reason);
  
  // Reintentar conexión después de 10 segundos
  setTimeout(() => {
    logger.info('Reintentando conexión...');
    client.initialize().catch(err => {
      logger.error('Error al reintentar conexión:', err);
    });
  }, 10000);
});

// Evento de error
client.on('auth_failure', (msg) => {
  connectionStatus.isAuthenticated = false;
  logger.error('Fallo de autenticación:', msg);
});

// Ruta para verificar estado
app.get('/status', (req, res) => {
  res.json({
    status: connectionStatus,
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Ruta mejorada para enviar mensaje
app.post('/send-message', async (req, res) => {
  if (!connectionStatus.isConnected) {
    return res.status(503).json({ 
      error: 'WhatsApp no está conectado',
      status: connectionStatus 
    });
  }

  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ 
      error: 'Número y mensaje son requeridos',
      example: { number: '5491112345678', message: 'Hola mundo' }
    });
  }

  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    const sentMsg = await client.sendMessage(chatId, message);
    
    logger.info('Mensaje enviado', { 
      to: chatId,
      messageId: sentMsg.id._serialized 
    });
    
    res.json({ 
      success: true,
      messageId: sentMsg.id._serialized,
      timestamp: new Date()
    });
  } catch (err) {
    logger.error('Error enviando mensaje:', { 
      error: err.message,
      stack: err.stack 
    });
    
    res.status(500).json({ 
      error: err.message,
      details: 'Verifica que el número tenga formato correcto (ej: 5491112345678)'
    });
  }
});

// Ruta para reiniciar la conexión
app.post('/restart', async (req, res) => {
  try {
    logger.info('Reiniciando conexión de WhatsApp...');
    await client.destroy();
    await client.initialize();
    res.json({ success: true, message: 'Reinicio iniciado' });
  } catch (err) {
    logger.error('Error al reiniciar:', err);
    res.status(500).json({ error: err.message });
  }
});

// Inicialización del servidor
async function startServer() {
  await initializeDatabase();
  
  // Cargar sesión existente
  const savedSession = await loadSession();
  if (savedSession) {
    logger.info('Sesión anterior encontrada');
  }

  const PORT = process.env.PORT || 10000;
  app.listen(PORT, () => {
    logger.info(`Servidor corriendo en puerto ${PORT}`);
    
    // Inicializar WhatsApp después de que el servidor esté listo
    client.initialize().catch(err => {
      logger.error('Error al inicializar WhatsApp:', err);
    });
  });
}

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Iniciar el servidor
startServer().catch(err => {
  logger.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
