const mongoose = require('mongoose');
require('dotenv').config();

async function clearUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        // Clear users collection
        const User = require('../models/User');
        await User.deleteMany({});
        
        console.log('All users have been deleted successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error clearing users:', error);
        process.exit(1);
    }
}

clearUsers();
