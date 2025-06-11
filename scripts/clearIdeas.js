require('dotenv').config();
const mongoose = require('mongoose');
const Idea = require('../models/Idea');

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('Connected to MongoDB');
    
    // Delete all ideas
    return Idea.deleteMany({});
})
.then(() => {
    console.log('All ideas have been deleted');
    process.exit(0);
})
.catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
