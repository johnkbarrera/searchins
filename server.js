require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* ══════════════════════════════════════════
   MIDDLEWARE
   ══════════════════════════════════════════ */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ══════════════════════════════════════════
   MONGOOSE — MODELO DE SCORE
   ══════════════════════════════════════════ */
const scoreSchema = new mongoose.Schema({
  player: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30,
  },
  time: {
    type: Number,  // segundos
    required: true,
  },
  result: {
    type: String,
    enum: ['win', 'loss'],
    required: true,
  },
  difficulty: {
    rows:  { type: Number, required: true },
    cols:  { type: Number, required: true },
    mines: { type: Number, required: true },
    preset: { type: String, default: 'custom' }, // easy | medium | hard | extreme | custom
  },
  // Estadísticas extra
  cellsRevealed: { type: Number, default: 0 },
  flagsUsed:     { type: Number, default: 0 },
  playedAt: {
    type: Date,
    default: Date.now,
  },
});

// Índices para consultas rápidas del leaderboard
scoreSchema.index({ result: 1, 'difficulty.preset': 1, time: 1 });
scoreSchema.index({ player: 1, playedAt: -1 });

const Score = mongoose.model('Score', scoreSchema);

/* ══════════════════════════════════════════
   API ROUTES
   ══════════════════════════════════════════ */

// ─── POST /api/scores — Guardar partida ───
app.post('/api/scores', async (req, res) => {
  try {
    const { player, time, result, difficulty, cellsRevealed, flagsUsed } = req.body;

    // Validación básica
    if (!player || typeof time !== 'number' || !result || !difficulty) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const score = await Score.create({
      player: player.substring(0, 30),
      time,
      result,
      difficulty,
      cellsRevealed: cellsRevealed || 0,
      flagsUsed: flagsUsed || 0,
    });

    res.status(201).json({ success: true, score });
  } catch (err) {
    console.error('Error guardando score:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /api/scores/leaderboard — Top scores (victorias) ───
app.get('/api/scores/leaderboard', async (req, res) => {
  try {
    const {
      preset = 'medium',
      limit = 20,
    } = req.query;

    const filter = { result: 'win' };

    // Filtrar por preset o por config custom
    if (preset !== 'all') {
      filter['difficulty.preset'] = preset;
    }

    const scores = await Score.find(filter)
      .sort({ time: 1 })           // menor tiempo = mejor
      .limit(Math.min(Number(limit), 100))
      .select('player time difficulty playedAt cellsRevealed flagsUsed')
      .lean();

    res.json({ success: true, scores });
  } catch (err) {
    console.error('Error obteniendo leaderboard:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /api/scores/player/:name — Historial de un jugador ───
app.get('/api/scores/player/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { limit = 50 } = req.query;

    const scores = await Score.find({ player: new RegExp(`^${name}$`, 'i') })
      .sort({ playedAt: -1 })
      .limit(Math.min(Number(limit), 200))
      .lean();

    // Estadísticas agregadas
    const stats = await Score.aggregate([
      { $match: { player: new RegExp(`^${name}$`, 'i') } },
      {
        $group: {
          _id: null,
          totalGames: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          bestTime: { $min: { $cond: [{ $eq: ['$result', 'win'] }, '$time', null] } },
          avgTime: { $avg: { $cond: [{ $eq: ['$result', 'win'] }, '$time', null] } },
        },
      },
    ]);

    res.json({
      success: true,
      scores,
      stats: stats[0] || { totalGames: 0, wins: 0, losses: 0, bestTime: null, avgTime: null },
    });
  } catch (err) {
    console.error('Error obteniendo historial:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── GET /api/scores/stats — Estadísticas globales ───
app.get('/api/scores/stats', async (req, res) => {
  try {
    const stats = await Score.aggregate([
      {
        $group: {
          _id: '$difficulty.preset',
          totalGames: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          bestTime: { $min: { $cond: [{ $eq: ['$result', 'win'] }, '$time', null] } },
          avgTime: { $avg: { $cond: [{ $eq: ['$result', 'win'] }, '$time', null] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error obteniendo stats:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/* ══════════════════════════════════════════
   FALLBACK — SPA
   ══════════════════════════════════════════ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ══════════════════════════════════════════
   MONGO CONNECTION + SERVER START
   ══════════════════════════════════════════ */
async function start() {
  try {
    console.log('⏳ Conectando a MongoDB Atlas...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB conectado');

    app.listen(PORT, () => {
      console.log(`\n⚓ PORTAMINAS corriendo en http://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err.message);
    process.exit(1);
  }
}

start();
