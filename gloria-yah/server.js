require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initSocket } = require('./services/socket');

const authRoutes = require('./routes/auth');
const ridesRoutes = require('./routes/rides');
const walletRoutes = require('./routes/wallet');
const vehiclesRoutes = require('./routes/vehicles');
const adminRoutes = require('./routes/admin');
const driversRoutes = require('./routes/drivers');
const assistantRoutes = require('./routes/assistant');
const addressesRoutes = require('./routes/addresses');
const ussdRoutes = require('./routes/ussd');
const whatsappRoutes = require('./routes/whatsapp');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10mb : nécessaire pour accepter les photos de véhicule envoyées en base64
app.use(express.urlencoded({ extended: true })); // requis par le format standard des passerelles USSD
// NOTE (audit 31/08/2026) : ce backend ne sert plus aucun frontend depuis la
// séparation en 3 sites Firebase Hosting distincts (passager/pilote/admin) —
// l'ancienne ligne express.static(path.join(__dirname, 'public')) pointait
// vers un dossier qui n'existe plus, code mort retiré.

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/rides', ridesRoutes);
app.use('/api/v1/wallet', walletRoutes); // inclut aussi POST /api/v1/wallet/webhooks/kkiapay
app.use('/api/v1/vehicles', vehiclesRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/drivers', driversRoutes);
app.use('/api/v1/assistant', assistantRoutes);
app.use('/api/v1/addresses', addressesRoutes);
app.use('/api/v1/ussd', ussdRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);

app.get('/api/v1/health', (req, res) => res.json({ status: 'ok', service: 'GLORI-YAH API' }));

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
initSocket(server);
server.listen(PORT, () => console.log(`GLORI-YAH API en écoute sur http://localhost:${PORT}`));
