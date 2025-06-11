const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function seedUser() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        // Clear existing users
        await User.deleteMany({});
        
        // Create test user
        const user = new User({
            username: 'testuser',
            email: 'test@example.com',
            password: 'password' // Will be hashed by userSchema.pre('save') middleware
        });
        
        await user.save();
        console.log('Successfully created test user');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding user:', error);
        process.exit(1);
    }
}

seedUser();
