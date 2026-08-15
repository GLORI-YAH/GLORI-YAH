require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const ridesRoutes = require('./routes/rides');
const walletRoutes = require('./routes/wallet');
const vehiclesRoutes = require('./routes/vehicles');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/rides', ridesRoutes);
app.use('/api/v1/wallet', walletRoutes); // inclut aussi POST /api/v1/wallet/webhooks/kkiapay
app.use('/api/v1/vehicles', vehiclesRoutes);
app.use('/api/v1/admin', adminRoutes);

app.get('/api/v1/health', (req, res) => res.json({ status: 'ok', service: 'GLORIA-YAH API' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GLORIA-YAH API en écoute sur http://localhost:${PORT}`));
