const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const cors = require('cors');

// Configuración
const config = {
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://kiddobellamy:Bellamy31@cluster0.tvm5mol.mongodb.net/whatsapp-sessions?retryWrites=true&w=majority&appName=Cluster0',
    CLIENT_ID: process.env.CLIENT_ID || 'client-1',
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'production'
};

const app = express();
const PORT = config.PORT;

// Middleware
app.use(express.json());
app.use(cors());

// Variables globales
let client;
let qrString = '';
let isReady = false;
let store;

// Esquema para logs de mensajes
const messageLogSchema = new mongoose.Schema({
    clientId: { type: String, required: true },
    type: { type: String, required: true }, // 'sent', 'received'
    to: { type: String },
    from: { type: String },
    message: { type: String, required: true },
    messageId: { type: String },
    timestamp: { type: Date, default: Date.now }
});

const MessageLog = mongoose.model('MessageLog', messageLogSchema);

// Conectar a MongoDB
async function connectMongoDB() {
    try {
        await mongoose.connect(config.MONGODB_URI);
        console.log('✅ Conectado a MongoDB');
        
        // Crear el store para sesiones remotas
        store = new MongoStore({ mongoose: mongoose });
        return true;
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        return false;
    }
}

// Guardar log de mensaje
async function saveMessageLog(logData) {
    try {
        const messageLog = new MessageLog({
            clientId: config.CLIENT_ID,
            ...logData
        });
        await messageLog.save();
        console.log('💾 Log de mensaje guardado');
    } catch (error) {
        console.error('❌ Error guardando log:', error);
    }
}

// Inicializar cliente de WhatsApp con sesión remota
async function initializeWhatsApp() {
    try {
        console.log('🚀 Inicializando WhatsApp con sesión remota...');
        
        client = new Client({
            authStrategy: new RemoteAuth({
                clientId: config.CLIENT_ID,
                store: store,
                backupSyncIntervalMs: 300000 // 5 minutos
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
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-extensions',
                    '--disable-plugins',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            }
        });

        // Eventos del cliente
        client.on('qr', async (qr) => {
            console.log('📱 Código QR generado');
            qrString = qr;
            try {
                const qrImage = await qrcode.toDataURL(qr);
                console.log('✅ QR disponible en /qr-image');
            } catch (err) {
                console.error('❌ Error generando QR:', err);
            }
        });

        client.on('ready', async () => {
            console.log('✅ WhatsApp Web está listo!');
            console.log('📱 Cliente:', client.info?.wid?.user);
            isReady = true;
            qrString = '';
        });

        client.on('authenticated', () => {
            console.log('🔐 Cliente autenticado - sesión guardada remotamente');
        });

        client.on('auth_failure', (msg) => {
            console.error('❌ Fallo en la autenticación:', msg);
            isReady = false;
            qrString = '';
        });

        client.on('disconnected', async (reason) => {
            console.log('📱 Cliente desconectado:', reason);
            isReady = false;
            qrString = '';
            
            // Reintentar conexión después de 10 segundos
            if (reason !== 'LOGOUT') {
                console.log('🔄 Reintentando conexión en 10 segundos...');
                setTimeout(() => {
                    initializeWhatsApp();
                }, 10000);
            }
        });

        // Evento para sesión remota guardada
        client.on('remote_session_saved', () => {
            console.log('💾 Sesión guardada remotamente en MongoDB');
        });

        // Manejar mensajes recibidos (opcional)
        client.on('message', async (message) => {
            if (!message.fromMe) {
                await saveMessageLog({
                    type: 'received',
                    from: message.from,
                    message: message.body,
                    messageId: message.id._serialized
                });
            }
        });

        // Inicializar cliente
        await client.initialize();
        
    } catch (error) {
        console.error('❌ Error inicializando WhatsApp:', error);
        throw error;
    }
}

// Rutas de la API

// Ruta de salud
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        whatsapp: isReady ? 'connected' : 'disconnected',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        clientId: config.CLIENT_ID,
        sessionType: 'remote'
    });
});

// Obtener código QR como JSON
app.get('/qr', async (req, res) => {
    try {
        if (isReady) {
            return res.json({ 
                success: false, 
                message: 'WhatsApp ya está conectado',
                clientInfo: client.info
            });
        }

        if (!qrString) {
            return res.json({ 
                success: false, 
                message: 'Código QR no disponible. Espera unos segundos...' 
            });
        }

        const qrImage = await qrcode.toDataURL(qrString);
        res.json({
            success: true,
            qr: qrString,
            qrImage: qrImage,
            message: 'Escanea este código QR con WhatsApp'
        });
    } catch (error) {
        console.error('Error obteniendo QR:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Mostrar código QR como imagen HTML
app.get('/qr-image', async (req, res) => {
    try {
        if (isReady) {
            return res.send(`
                <html>
                    <head>
                        <title>WhatsApp QR</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { 
                                font-family: Arial, sans-serif; 
                                text-align: center; 
                                padding: 20px; 
                                background: linear-gradient(135deg, #25D366, #128C7E);
                                margin: 0;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            .container {
                                background: white;
                                padding: 40px;
                                border-radius: 20px;
                                box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                                max-width: 400px;
                            }
                            .status {
                                color: #25D366;
                                font-size: 20px;
                                margin: 20px 0;
                                font-weight: bold;
                            }
                            .check {
                                font-size: 60px;
                                color: #25D366;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="check">✅</div>
                            <h1>WhatsApp Conectado</h1>
                            <div class="status">Tu WhatsApp está vinculado y listo</div>
                            <p>La sesión está guardada remotamente en MongoDB</p>
                            <p>✨ <strong>Usuario:</strong> ${client.info?.wid?.user || 'Conectado'}</p>
                            <hr style="margin: 20px 0; border: 1px solid #eee;">
                            <p style="color: #666;">Puedes usar la API para enviar mensajes desde N8N</p>
                        </div>
                    </body>
                </html>
            `);
        }

        if (!qrString) {
            return res.send(`
                <html>
                    <head>
                        <title>WhatsApp QR</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { 
                                font-family: Arial, sans-serif; 
                                text-align: center; 
                                padding: 20px; 
                                background: linear-gradient(135deg, #ff6b6b, #ffa726);
                                margin: 0;
                                min-height: 100vh;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                            }
                            .container {
                                background: white;
                                padding: 40px;
                                border-radius: 20px;
                                box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                                max-width: 400px;
                            }
                            .spinner {
                                border: 4px solid #f3f3f3;
                                border-top: 4px solid #ff6b6b;
                                border-radius: 50%;
                                width: 40px;
                                height: 40px;
                                animation: spin 1s linear infinite;
                                margin: 20px auto;
                            }
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                            .refresh-btn {
                                background: #ff6b6b;
                                color: white;
                                border: none;
                                padding: 12px 24px;
                                border-radius: 25px;
                                cursor: pointer;
                                font-size: 16px;
                                margin: 20px;
                                transition: all 0.3s;
                            }
                            .refresh-btn:hover {
                                background: #ff5252;
                                transform: translateY(-2px);
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="spinner"></div>
                            <h1>⏳ Preparando WhatsApp</h1>
                            <p>Generando código QR con sesión remota...</p>
                            <p style="color: #666;">Esto puede tomar unos segundos</p>
                            <button class="refresh-btn" onclick="window.location.reload()">
                                🔄 Actualizar
                            </button>
                        </div>
                        <script>
                            setTimeout(() => window.location.reload(), 5000);
                        </script>
                    </body>
                </html>
            `);
        }

        const qrImage = await qrcode.toDataURL(qrString);
        res.send(`
            <html>
                <head>
                    <title>WhatsApp QR - Sesión Remota</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            text-align: center; 
                            padding: 20px; 
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            margin: 0;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .container {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                            max-width: 450px;
                        }
                        .qr-image {
                            border: 3px solid #667eea;
                            border-radius: 15px;
                            margin: 20px 0;
                            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                        }
                        .instructions {
                            color: #555;
                            font-size: 16px;
                            margin: 25px 0;
                            line-height: 1.6;
                        }
                        .step {
                            margin: 12px 0;
                            padding: 15px;
                            background: linear-gradient(135deg, #f8f9fa, #e9ecef);
                            border-radius: 10px;
                            border-left: 4px solid #667eea;
                        }
                        .refresh-btn {
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            color: white;
                            border: none;
                            padding: 12px 24px;
                            border-radius: 25px;
                            cursor: pointer;
                            font-size: 16px;
                            margin: 15px;
                            transition: all 0.3s;
                            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                        }
                        .refresh-btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(0,0,0,0.3);
                        }
                        .badge {
                            background: #28a745;
                            color: white;
                            padding: 5px 15px;
                            border-radius: 20px;
                            font-size: 12px;
                            margin: 10px 0;
                            display: inline-block;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>📱 Vincular WhatsApp</h1>
                        <div class="badge">🏢 Sesión Remota MongoDB</div>
                        
                        <img src="${qrImage}" alt="WhatsApp QR Code" class="qr-image" width="280" height="280">
                        
                        <div class="instructions">
                            <h3>📋 Pasos para vincular:</h3>
                            <div class="step">
                                <strong>1️⃣</strong> Abre WhatsApp en tu teléfono
                            </div>
                            <div class="step">
                                <strong>2️⃣</strong> Ve a <strong>Configuración → Dispositivos vinculados</strong>
                            </div>
                            <div class="step">
                                <strong>3️⃣</strong> Toca <strong>"Vincular un dispositivo"</strong>
                            </div>
                            <div class="step">
                                <strong>4️⃣</strong> Escanea este código QR
                            </div>
                        </div>
                        
                        <button class="refresh-btn" onclick="window.location.reload()">
                            🔄 Actualizar QR
                        </button>
                        
                        <div style="margin-top: 25px; padding: 15px; background: #e3f2fd; border-radius: 10px; font-size: 13px; color: #1565c0;">
                            ✨ <strong>Ventaja:</strong> Tu sesión se guardará en la nube (MongoDB)<br>
                            🔄 No perderás la conexión al reiniciar el servidor
                        </div>
                        
                        <div style="margin-top: 15px; font-size: 11px; color: #999;">
                            Este código QR expira en unos minutos
                        </div>
                    </div>
                    
                    <script>
                        // Auto-refresh cada 30 segundos
                        setTimeout(() => {
                            window.location.reload();
                        }, 30000);
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('Error mostrando QR:', error);
        res.status(500).send(`
            <html>
                <head><title>Error</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px; background: #ffebee;">
                    <div style="background: white; padding: 30px; border-radius: 10px; display: inline-block;">
                        <h1 style="color: #d32f2f;">❌ Error</h1>
                        <p>No se pudo generar el código QR</p>
                        <p style="color: #666; font-size: 14px;">${error.message}</p>
                        <button onclick="window.location.reload()" style="background: #d32f2f; color: white; border: none; padding: 10px 20px; border-radius: 5px;">
                            🔄 Reintentar
                        </button>
                    </div>
                </body>
            </html>
        `);
    }
});

// Enviar mensaje
app.post('/send-message', async (req, res) => {
    try {
        if (!isReady) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp no está conectado. Escanea el código QR primero.',
                qrAvailable: !!qrString
            });
        }

        const { number, message } = req.body;

        if (!number || !message) {
            return res.status(400).json({
                success: false,
                error: 'Número y mensaje son requeridos',
                example: {
                    number: "1234567890",
                    message: "Hola desde la API con sesión remota"
                }
            });
        }

        // Formatear número
        const chatId = number.includes('@') ? number : `${number}@c.us`;

        // Verificar si el número existe
        const isValidNumber = await client.isRegisteredUser(chatId);
        if (!isValidNumber) {
            return res.status(400).json({
                success: false,
                error: 'El número no está registrado en WhatsApp'
            });
        }

        // Enviar mensaje
        const sentMessage = await client.sendMessage(chatId, message);

        // Guardar log del mensaje
        await saveMessageLog({
            type: 'sent',
            to: number,
            message: message,
            messageId: sentMessage.id._serialized
        });

        res.json({
            success: true,
            message: 'Mensaje enviado correctamente',
            messageId: sentMessage.id._serialized,
            to: number,
            timestamp: new Date().toISOString(),
            sessionType: 'remote'
        });

    } catch (error) {
        console.error('Error enviando mensaje:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obtener estado de la conexión
app.get('/status', async (req, res) => {
    try {
        res.json({
            isReady,
            hasQR: !!qrString,
            clientState: client ? client.info : null,
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            clientId: config.CLIENT_ID,
            sessionType: 'remote',
            storeConnected: !!store
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Desconectar WhatsApp
app.post('/disconnect', async (req, res) => {
    try {
        if (client) {
            await client.logout();
            isReady = false;
            qrString = '';
        }
        res.json({ 
            success: true, 
            message: 'Cliente desconectado y sesión remota eliminada' 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reconectar WhatsApp
app.post('/reconnect', async (req, res) => {
    try {
        if (client) {
            await client.destroy();
        }
        
        // Limpiar datos
        isReady = false;
        qrString = '';
        
        // Reinicializar
        await initializeWhatsApp();
        res.json({ 
            success: true, 
            message: 'Reconectando con sesión remota... Verifica /qr-image si necesitas escanear código' 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener logs de mensajes
app.get('/message-logs', async (req, res) => {
    try {
        const { limit = 50, type } = req.query;
        
        const filter = { clientId: config.CLIENT_ID };
        if (type) filter.type = type;
        
        const logs = await MessageLog.find(filter)
                                    .sort({ timestamp: -1 })
                                    .limit(parseInt(limit));
        
        res.json({
            success: true,
            logs: logs,
            count: logs.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp Web API con Sesión Remota',
        status: 'running',
        version: '2.0.0',
        whatsapp: isReady ? 'connected' : 'disconnected',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        sessionType: 'remote',
        features: [
            '✅ Sesión guardada remotamente en MongoDB',
            '✅ Sin archivos locales (.wwebjs_auth)',
            '✅ Persistencia completa en la nube',
            '✅ Compatible con Render/Vercel/Railway'
        ],
        endpoints: {
            health: 'GET /health - Estado del servicio',
            qr: 'GET /qr - Código QR en JSON',
            qrImage: 'GET /qr-image - Código QR como imagen HTML',
            sendMessage: 'POST /send-message - Enviar mensaje',
            status: 'GET /status - Estado detallado',
            disconnect: 'POST /disconnect - Desconectar WhatsApp',
            reconnect: 'POST /reconnect - Reconectar WhatsApp',
            messageLogs: 'GET /message-logs - Historial de mensajes'
        },
        example: {
            sendMessage: {
                url: '/send-message',
                method: 'POST',
                body: {
                    number: '1234567890',
                    message: 'Hola desde N8N con sesión remota!'
                }
            }
        }
    });
});

// Manejo de errores
app.use((error, req, res, next) => {
    console.error('Error no manejado:', error);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
    });
});

// Cerrar limpiamente
process.on('SIGTERM', async () => {
    console.log('🔄 Cerrando servidor...');
    if (client) {
        await client.destroy();
    }
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Cerrando servidor...');
    if (client) {
        await client.destroy();
    }
    await mongoose.connection.close();
    process.exit(0);
});

// Inicializar servidor
async function startServer() {
    try {
        // Conectar a MongoDB
        const mongoConnected = await connectMongoDB();
        if (!mongoConnected) {
            throw new Error('No se pudo conectar a MongoDB');
        }

        // Inicializar WhatsApp
        await initializeWhatsApp();

        // Iniciar servidor
        app.listen(PORT, () => {
            console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
            console.log(`📱 WhatsApp API con sesión remota`);
            console.log(`☁️  Sesión guardada en MongoDB (no local)`);
            console.log(`🔗 Endpoints:`);
            console.log(`   • http://localhost:${PORT}/ - Info general`);
            console.log(`   • http://localhost:${PORT}/qr-image - Código QR`);
            console.log(`   • http://localhost:${PORT}/health - Estado`);
        });

    } catch (error) {
        console.error('❌ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Iniciar servidor
startServer();
