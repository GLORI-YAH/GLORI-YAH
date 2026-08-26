const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chatWithAssistant } = require('../services/assistant');

const router = express.Router();

// POST /api/v1/assistant/chat
router.post('/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message est requis' });

  try {
    const result = await chatWithAssistant(message, { role: req.user.role });
    res.json(result);
  } catch (err) {
    console.error('Erreur assistant IA :', err.message);
    res.status(502).json({ error: 'Assistant temporairement indisponible : ' + err.message });
  }
});

module.exports = router;
