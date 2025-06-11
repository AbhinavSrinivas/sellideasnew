const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Test endpoint
router.get('/', (req, res) => {
  res.json({ message: 'Auth API is working!' });
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key', {
      expiresIn: '24h'
    });

    // Include user info in response
    res.json({ 
      token,
      user: { 
        username: user.username,
        email: user.email
      } 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    // Validate field lengths
    if (username.trim().length === 0 || email.trim().length === 0) {
      return res.status(400).json({ error: 'Username and email must contain valid text' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if email is already registered
    const existingEmail = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if username is taken
    const existingUsername = await User.findOne({ username: username.trim() });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Create user object with validated data
    const userData = {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password
    };

    // Ensure all fields are present and not empty
    if (!userData.username || !userData.email || !userData.password) {
      return res.status(400).json({ error: 'Invalid data received' });
    }

    const user = new User(userData);
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key', {
      expiresIn: '24h'
    });

    // Include user info in response
    res.json({ 
      token,
      user: { 
        username: user.username,
        email: user.email
      } 
    });
  } catch (error) {
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ error: validationErrors.join(', ') });
    }
    res.status(400).json({ error: error.message });
  }
});

// Cleanup route for development (remove before production)
router.delete('/cleanup', async (req, res) => {
  try {
    await User.deleteMany({});
    res.json({ message: 'Users collection cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
