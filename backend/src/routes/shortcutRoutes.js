const { wrapRouterAsync } = require('../utils/expressAsync');
// backend/src/routes/shortcutRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const shortcutController = require('../controllers/shortcutController');

router.post('/shortcuts/quick-book', authMiddleware, shortcutController.handleQuickBookShortcut);

wrapRouterAsync(router);
module.exports = router;
