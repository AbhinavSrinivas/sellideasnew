const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    trim: true,
    unique: true,
    validate: {
      validator: function(v) {
        return v && v.trim().length > 0;
      },
      message: 'Username cannot be empty'
    }
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return v && v.trim().length > 0;
      },
      message: 'Email cannot be empty'
    }
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    validate: {
      validator: function(v) {
        return v && v.trim().length >= 6;
      },
      message: 'Password must be at least 6 characters'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save validation
userSchema.pre('save', async function(next) {
  // Validate required fields
  if (!this.username || !this.email || !this.password) {
    const errors = [];
    if (!this.username) errors.push('Username is required');
    if (!this.email) errors.push('Email is required');
    if (!this.password) errors.push('Password is required');
    
    const error = new Error(errors.join(', '));
    error.name = 'ValidationError';
    throw error;
  }

  // Trim and validate string fields
  if (this.username) this.username = this.username.trim();
  if (this.email) this.email = this.email.trim().toLowerCase();
  
  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
