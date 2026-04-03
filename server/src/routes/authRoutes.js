const express = require('express');

const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/me', requireAuth, authController.me);
router.post('/profile/request-otp', requireAuth, authController.requestProfileOtp);
router.put('/profile', requireAuth, authController.updateProfile);
router.post('/profile/change-password', requireAuth, authController.changePassword);
router.post('/profile/delete', requireAuth, authController.deleteAccount);

module.exports = router;
