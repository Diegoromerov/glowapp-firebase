const { wrapRouterAsync } = require('../../utils/expressAsync');
const express = require('express');
const router = express.Router();
const workforceController = require('../../controllers/workforceController');
const { authMiddleware } = require('../../middleware/auth');

// All routes require authentication
router.use(authMiddleware);

// GET /api/v1/workforce
router.get('/', workforceController.getWorkforce);

// GET /api/v1/workforce/:id
router.get('/:id', workforceController.getWorkforceById);

// PATCH /api/v1/workforce/:id
router.patch('/:id', workforceController.updateWorkforce);

// DELETE /api/v1/workforce/:id (deactivate)
router.delete('/:id', workforceController.deactivateWorkforce);

wrapRouterAsync(router);
module.exports = router;