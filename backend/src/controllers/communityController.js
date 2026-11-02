// src/controllers/communityController.js
const Joi = require('joi');
const { CommunityPost, CommunityComment } = require('../models');

// Validation schemas (allow unknown fields)
const postSchema = Joi.object({ title: Joi.string().required(), content: Joi.string().allow('').optional() }).unknown(true);
const commentSchema = Joi.object({ post_id: Joi.number().integer().required(), content: Joi.string().required() }).unknown(true);

// Posts
async function getPosts(req, res) {
  try {
    const posts = await CommunityPost.findAll();
    return res.json(posts);
  } catch (err) {
    console.error('Error fetching community posts:', err);
    return res.status(500).json({ error: 'Error fetching community posts.' });
  }
}

async function createPost(req, res) {
  try {
    // Validate request body
    const { error } = postSchema.validate({ ...req.body, user_id: req.user.id });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const post = await CommunityPost.create({ ...req.body, user_id: req.user.id });
    return res.status(201).json(post);
  } catch (err) {
    console.error('Error creating community post:', err);
    return res.status(500).json({ error: 'Error creating community post.' });
  }
}

// Comments
async function createComment(req, res) {
  try {
    // Validate request body
    const { error } = commentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    const comment = await CommunityComment.create(req.body);
    return res.status(201).json(comment);
  } catch (err) {
    console.error('Error creating community comment:', err);
    return res.status(500).json({ error: 'Error creating comment.' });
  }
}

module.exports = {
  getPosts,
  createPost,
  createComment,
};
