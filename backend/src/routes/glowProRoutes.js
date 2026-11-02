const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/glowProRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// Import models used directly (if needed) – most logic moved to dedicated controllers
const { UserBadge, QrCertificate, Event, EventRegistration } = require('../models');
const userBadgeController = require('../controllers/userBadgeController');
const { validateBadge } = require('../middleware/validation');

// ----- User Levels ----- (moved to separate route file `userLevelRoutes.js`)
// router.get('/user-levels', ...);
// router.post('/user-levels', ...);

// ----- XP Logs ----- (moved to separate route file `xpLogRoutes.js`)
// router.get('/xp-logs', ...);
// router.post('/xp-logs', ...);

// ----- Community ----- (moved to `communityRoutes.js`)
// router.get('/community/posts', ...);
// router.post('/community/posts', ...);
// router.post('/community/comments', ...);

// ----- Portfolio ----- (moved to `portfolioRoutes.js`)
// router.get('/portfolios', ...);
// router.post('/portfolios', ...);

// ----- Mentorship Sessions ----- (moved to `mentorshipRoutes.js`)
// router.get('/mentorship-sessions', ...);
// router.post('/mentorship-sessions', ...);

// ----- QR Certificates ----- (still here)
router.get('/qr-certificates', authMiddleware, async (req, res) => {
  try {
    const certs = await QrCertificate.findAll({ where: { user_id: req.user.id } });
    res.json(certs);
  } catch (err) {
    console.error('Error fetching QR certificates:', err);
    res.status(500).json({ error: 'Error fetching QR certificates.' });
  }
});
router.post('/qr-certificates', authMiddleware, async (req, res) => {
  try {
    const cert = await QrCertificate.create({ ...req.body, user_id: req.user.id });
    res.status(201).json(cert);
  } catch (err) {
    console.error('Error creating QR certificate:', err);
    res.status(500).json({ error: 'Error creating QR certificate.' });
  }
});

// ----- Events ----- (still here, but CRUD moved to dedicated controller routes)
router.get('/events', authMiddleware, async (req, res) => {
  try {
    const events = await Event.findAll();
    res.json(events);
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Error fetching events.' });
  }
});
router.post('/events', authMiddleware, async (req, res) => {
  try {
    const ev = await Event.create(req.body);
    res.status(201).json(ev);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Error creating event.' });
  }
});

// ----- Event Registrations ----- (still here, but primary route moved to `eventRegistrationRoutes.js`)
router.post('/events/:id/register', authMiddleware, async (req, res) => {
  try {
    const registration = await EventRegistration.create({ event_id: req.params.id, user_id: req.user.id });
    res.status(201).json(registration);
  } catch (err) {
    console.error('Error registering for event:', err);
    res.status(500).json({ error: 'Error registering for event.' });
  }
});

// ----- Analytics Events (telemetry) ----- (moved to `analyticsRoutes.js`)
// router.post('/analytics', ...);

// ----- App Locales ----- (moved to `localesRoutes.js` – not yet created)
// router.get('/locales', ...);
// router.post('/locales', ...);

// ----- User Consents ----- (moved to `userConsentsRoutes.js` – not yet created)
// router.post('/consents', ...);

// ----- User Badges -----
router.get('/user-badges', authMiddleware, userBadgeController.list);
router.post('/user-badges', authMiddleware, validateBadge, userBadgeController.create);

wrapRouterAsync(router);
module.exports = router;
