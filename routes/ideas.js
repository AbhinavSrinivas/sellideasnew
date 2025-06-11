const express = require('express');
const router = express.Router();
const Idea = require('../models/Idea');
const auth = require('../middleware/auth');

// Get all ideas
router.get('/', async (req, res) => {
  try {
    const ideas = await Idea.find().populate('owner', 'username');
    res.json(ideas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new idea
router.post('/', auth, async (req, res) => {
  try {
    const idea = new Idea({
      ...req.body,
      owner: req.user.userId
    });
    await idea.save();
    await idea.populate('owner', 'username');
    res.status(201).json(idea);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete an idea (only by owner)
router.delete('/:id', auth, async (req, res) => {
  try {
    const idea = await Idea.findById(req.params.id);
    
    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    
    if (idea.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await Idea.findByIdAndDelete(req.params.id);
    res.json({ message: 'Idea deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
