import express from 'express';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { Pool } from 'pg';
import dotenv from 'dotenv';
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import expressStatusMonitor from 'express-status-monitor';
import fs from 'fs';

// Configuración de entorno
dotenv.config();

// Configuración de logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

// Configuración de rutas ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración de Express
const app = express();
app.use(express.json());

// Middleware de monitorización
app.use(expressStatusMonitor());

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
    logger.info('Database initialized successfully');
  } catch (err) {
    logger.error('Error initializing database:', err);
    process.exit(1);
  }
}

// Función para guardar sesión
async function saveSession(session) {
  if (!session) {
    logger.warn('No session data to save');
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
    
    logger.info('Session saved successfully', { 
      rowsAffected: result.rowCount 
    });
  } catch (err) {
    logger.error('Error saving session:', err);
    throw err;
  }
}

// Función para cargar sesión
async function loadSession() {
  try {
    const result = await pool.query(
      'SELECT session_data FROM whatsapp_sessions WHERE id = 1'
    );
    return result.rows[0]?.session_data 
      ? JSON.parse(result.rows[0].session_data) 
      : null;
  } catch (err) {
    logger.error('Error loading session:', err);
    return null;
  }
}

// Configuración del cliente de WhatsApp
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
  lastSync: null,
  qrGenerated: false
};

// Evento QR
client.on('qr', async (qr) => {
  connectionStatus.isConnected = false;
  connectionStatus.isAuthenticated = false;
  connectionStatus.qrGenerated = true;
  
  logger.info('QR code generated - waiting for scan');
  
  try {
    const qrImage = await qrcode.toDataURL(qr);
    app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WhatsApp Web Server</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
            .status { margin: 20px auto; padding: 15px; max-width: 500px; border: 1px solid #ddd; border-radius: 5px; }
            .qr-container { margin: 20px auto; }
          </style>
        </head>
        <body>
          <h1>WhatsApp Web Server</h1>
          <div class="qr-container">
            <p>Scan this QR code with WhatsApp on your phone:</p>
            <img src="${qrImage}" style="width: 300px; height: 300px;"/>
          </div>
          <div class="status">
            <h3>Connection Status</h3>
            <pre>${JSON.stringify(connectionStatus, null, 2)}</pre>
          </div>
        </body>
        </html>
      `);
    });
  } catch (err) {
    logger.error('Error generating QR code:', err);
  }
});

// Evento de autenticación
client.on('authenticated', async (session) => {
  connectionStatus.isAuthenticated = true;
  connectionStatus.qrGenerated = false;
  logger.info('Authenticated successfully');
  await saveSession(session);
});

// Evento de carga
client.on('loading_screen', (percent, message) => {
  connectionStatus.isSyncing = true;
  logger.info(`Loading: ${percent}% - ${message}`);
});

// Evento ready
client.on('ready', () => {
  connectionStatus.isConnected = true;
  connectionStatus.isAuthenticated = true;
  connectionStatus.isSyncing = false;
  connectionStatus.lastSync = new Date();
  connectionStatus.qrGenerated = false;
  
  logger.info('WhatsApp client is ready');
});

// Evento de cambio de estado
client.on('change_state', (state) => {
  logger.info('State changed:', state);
  connectionStatus.isConnected = state === 'CONNECTED';
});

// Evento de desconexión
client.on('disconnected', (reason) => {
  connectionStatus.isConnected = false;
  connectionStatus.isAuthenticated = false;
  logger.warn('Disconnected:', reason);
  
  // Reintentar conexión después de 10 segundos
  setTimeout(() => {
    logger.info('Attempting to reconnect...');
    client.initialize().catch(err => {
      logger.error('Reconnection error:', err);
    });
  }, 10000);
});

// Ruta de estado
app.get('/status', (req, res) => {
  res.json({
    status: 'OK',
    whatsapp: connectionStatus,
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Ruta para enviar mensaje
app.post('/send-message', async (req, res) => {
  if (!connectionStatus.isConnected) {
    return res.status(503).json({ 
      error: 'WhatsApp is not connected',
      status: connectionStatus 
    });
  }

  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ 
      error: 'Number and message are required',
      example: { 
        number: '5491112345678', 
        message: 'Hello from WhatsApp server' 
      }
    });
  }

  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    const sentMsg = await client.sendMessage(chatId, message);
    
    logger.info('Message sent', { 
      to: chatId,
      messageId: sentMsg.id._serialized 
    });
    
    res.json({ 
      success: true,
      messageId: sentMsg.id._serialized,
      timestamp: new Date()
    });
  } catch (err) {
    logger.error('Error sending message:', err);
    
    res.status(500).json({ 
      error: err.message,
      details: 'Make sure the number has the correct format (e.g., 5491112345678)'
    });
  }
});

// Ruta para reiniciar la conexión
app.post('/restart', async (req, res) => {
  try {
    logger.info('Restarting WhatsApp connection...');
    await client.destroy();
    await client.initialize();
    res.json({ 
      success: true, 
      message: 'Restart initiated' 
    });
  } catch (err) {
    logger.error('Restart error:', err);
    res.status(500).json({ 
      error: err.message 
    });
  }
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Inicialización del servidor
async function startServer() {
  try {
    // Crear directorio de logs si no existe
    if (!fs.existsSync(path.join(__dirname, 'logs'))) {
      fs.mkdirSync(path.join(__dirname, 'logs'));
    }

    // Crear directorio de sesiones si no existe
    if (!fs.existsSync(path.join(__dirname, 'sessions'))) {
      fs.mkdirSync(path.join(__dirname, 'sessions'));
    }

    await initializeDatabase();
    
    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      
      // Inicializar cliente de WhatsApp
      client.initialize().catch(err => {
        logger.error('WhatsApp initialization error:', err);
      });
    });
  } catch (err) {
    logger.error('Server startup error:', err);
    process.exit(1);
  }
}

startServer();
