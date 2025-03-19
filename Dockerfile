FROM node:18-alpine

WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Create data directory for session files
RUN mkdir -p data/sessions

# Copy application code
COPY . .

# Expose port
EXPOSE 7000

# Start the application
CMD ["node", "server.js"] 