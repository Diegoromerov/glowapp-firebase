const express = require('express');
const { wrapRouterAsync } = require('../utils/expressAsync');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { adminAuditLog } = require('../middleware/adminAuditLog');
const controller = require('../controllers/newsletterController');

const router = express.Router();
router.use(authMiddleware, requireRol('admin'));
router.get('/newsletters', controller.list);
router.post('/newsletters', adminAuditLog({ action: 'newsletter.create', resource: 'newsletter_campaign' }), controller.create);
router.post('/newsletters/:id/send', adminAuditLog({ action: 'newsletter.send_batch', resource: 'newsletter_campaign' }), controller.sendBatch);
wrapRouterAsync(router);
module.exports = router;
