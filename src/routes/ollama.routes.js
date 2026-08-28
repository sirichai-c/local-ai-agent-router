const express = require('express');

const {
  getModels,
  getOllamaHealth,
  postChat,
} = require('../controllers/ollama.controller');

const router = express.Router();

router.get('/models', getModels);
router.get('/ollama/health', getOllamaHealth);
router.post('/chat', postChat);

module.exports = router;
