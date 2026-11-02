const { wrapRouterAsync } = require('../utils/expressAsync');
const express = require('express');
const router = express.Router();
const { register, login, logout, forgotPassword, resetPassword, oauth, onboarding, acceptBiometricsConsent, saveFcmToken, getReferralInfo, deleteAccount, changePassword, selectRole, switchContext } = require('../controllers/authController');
const { googleSignIn, facebookSignIn } = require('../controllers/oauthController');
const { authMiddleware } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', authMiddleware, logout);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/oauth', authLimiter, oauth);
router.post('/google', authLimiter, googleSignIn);
router.post('/facebook', authLimiter, facebookSignIn);
router.post('/select-role', authMiddleware, selectRole);
router.post('/context/switch', authMiddleware, switchContext);
router.patch('/onboarding', authMiddleware, onboarding);
router.patch('/biometrics/consent', authMiddleware, acceptBiometricsConsent);
router.post('/fcm-token', authMiddleware, saveFcmToken);
router.get('/referral-info', authMiddleware, getReferralInfo);
router.delete('/delete-account', authMiddleware, deleteAccount);
router.patch('/change-password', authMiddleware, changePassword);

wrapRouterAsync(router);
module.exports = router;