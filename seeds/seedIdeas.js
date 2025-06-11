const mongoose = require('mongoose');
require('dotenv').config();
const Idea = require('../models/Idea');

const sampleIdeas = [
    {
        title: 'AI-Powered Personal Shopping Assistant',
        description: 'An AI-powered app that helps users find the best fashion items based on their style preferences and budget. Features include outfit suggestions, price comparisons, and personalized shopping recommendations.',
        price: 99.99,
        owner: '6573c0c0e4b07b4d6d0e0000' // This is a sample user ID
    },
    {
        title: 'Smart Home Energy Management System',
        description: 'A comprehensive energy management system that helps homeowners monitor and optimize their energy usage. Features include real-time energy consumption tracking, automated device control, and energy-saving recommendations.',
        price: 199.99,
        owner: '6573c0c0e4b07b4d6d0e0000'
    },
    {
        title: 'Virtual Reality Fitness Platform',
        description: 'A VR-based fitness platform that offers immersive workout experiences. Users can choose from various workout scenarios, track their progress, and compete with friends in virtual environments.',
        price: 49.99,
        owner: '6573c0c0e4b07b4d6d0e0000'
    }
];

async function seedIdeas() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        // Clear existing ideas
        await Idea.deleteMany({});
        
        // Insert sample ideas
        await Idea.insertMany(sampleIdeas);
        
        console.log('Successfully seeded ideas');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding ideas:', error);
        process.exit(1);
    }
}

seedIdeas();
