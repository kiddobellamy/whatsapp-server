require('dotenv').config();
const express = require('express');
const { create } = require('@wppconnect-team/wppconnect');
const mongoose = require('mongoose');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://kiddobellamy:Bellamy31@cluster0.tvm5mol.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Conectado a MongoDB'))
.catch(err => console.error('Error de conexión a MongoDB:', err));

// Configuración del cliente WhatsApp con MongoDB
let client;

create({
  session: 'whatsapp-session',
  storage: {
    type: 'mongodb',
    url: process.env.MONGODB_URI || 'mongodb+srv://kiddobellamy:Bellamy31@cluster0.tvm5mol.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    dbName: 'whatsapp_sessions'
  },
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
})
.then((whatsappClient) => {
  client = whatsappClient;
  console.log('Cliente de WhatsApp inicializado');

  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea el código QR con tu teléfono');
  });

  client.on('ready', () => {
    console.log('Cliente de WhatsApp listo!');
  });

  client.on('authenticated', () => {
    console.log('Autenticado');
  });

  client.on('auth_failure', (msg) => {
    console.error('Error de autenticación', msg);
  });
})
.catch((err) => {
  console.error('Error al iniciar WhatsApp:', err);
});

// Ruta para enviar mensaje
app.post('/send-message', async (req, res) => {
  if (!client) {
    return res.status(503).json({ error: 'Cliente de WhatsApp no está listo' });
  }

  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: 'Número y mensaje son requeridos' });
  }

  try {
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await client.sendText(chatId, message);
    res.json({ success: true });
  } catch (err) {
    console.error('Error enviando mensaje:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    status: client ? 'ready' : 'initializing'
  });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
