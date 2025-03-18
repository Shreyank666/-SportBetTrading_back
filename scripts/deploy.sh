#!/bin/bash

# Backend deployment script for Sports Trading

# Exit on error
set -e

echo "Starting backend deployment..."

# Install dependencies
echo "Installing dependencies..."
npm install

echo "Backend deployment prepared successfully!"
echo ""
echo "To deploy to GitHub:"
echo "1. Commit your changes"
echo "2. Remove node_modules: rm -rf node_modules"
echo "3. Push to GitHub"
echo ""
echo "To deploy to Coolify VPS:"
echo "1. Configure a NodeJS application in Coolify pointing to this repository"
echo "2. Set the build command to: npm install"
echo "3. Set the start command to: node server.js"
echo "4. Set the Environment Variables:"
echo "   - NODE_ENV=production"
echo "   - PORT=3000 (or your preferred port)"
echo "   - FRONTEND_URL=http://localhost:3000"
echo "   - PRODUCTION_FRONTEND_URL=https://sportbet.umkk.life"
echo "   - JWT_SECRET=<generate-a-strong-32-character-random-string>"
echo "   - SESSION_SECRET=<generate-a-strong-32-character-random-string>"
echo ""
echo "IMPORTANT: For security reasons, use strong, unique random strings for JWT_SECRET and SESSION_SECRET"
echo "You can generate these using a command like:"
echo "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
echo ""
echo "Deployment script finished!" 