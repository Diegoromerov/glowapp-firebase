const { wrapRouterAsync } = require('../utils/expressAsync');
// src/routes/communityRoutes.js
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth');

// Validation schemas for community posts and comments
const postSchema = Joi.object({
  title: Joi.string().required(),
  content: Joi.string().allow('').optional()
});

const commentSchema = Joi.object({
  post_id: Joi.number().integer().required(),
  content: Joi.string().required()
});

// Middleware to validate request body against a Joi schema
function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    next();
  };
}
const communityController = require('../controllers/communityController');

// List community posts
router.get('/posts', authMiddleware, communityController.getPosts);

// Create a new community post
router.post('/posts', authMiddleware, validate(postSchema), communityController.createPost);

// Create a comment on a post
router.post('/comments', authMiddleware, validate(commentSchema), communityController.createComment);

wrapRouterAsync(router);
module.exports = router;
