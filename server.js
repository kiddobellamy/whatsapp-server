require('dotenv').config();
const express = require('express');
const { Client } = require('whatsapp-web.js');
const { MongoStore } = require('@wppconnect-team/wppconnect-store-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// Conexión segura a MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  ssl: true, // Para conexión segura
  authSource: 'admin'
}).then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error de MongoDB:', err));

// Configuración del cliente WhatsApp
const client = new Client({
  authStrategy: new MongoStore({
    mongoose: mongoose,
    collectionName: process.env.SESSION_COLLECTION || 'whatsapp_sessions'
  }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  }
});

// Manejo de QR
client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('🔍 Escanea el código QR con WhatsApp');
});

client.on('ready', () => {
  console.log('🚀 Cliente de WhatsApp listo!');
});

client.on('authenticated', () => {
  console.log('🔑 Sesión autenticada y guardada en MongoDB');
});

client.initialize();

// ... (tus rutas como /send-message)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Servidor escuchando en puerto ${PORT}`);
});
