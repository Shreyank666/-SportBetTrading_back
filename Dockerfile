FROM node:18-alpine

WORKDIR /app

# Copy package.json and install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy application code
COPY backend/ .

# Create data directory for users and sessions
RUN mkdir -p /app/data/sessions

# Set production environment
ENV NODE_ENV=production
ENV PORT=7000
ENV FRONTEND_URL=https://sportbet.umkk.life
ENV BACKEND_URL=https://backend.umkk.life

# Expose port
EXPOSE 7000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:7000/health || exit 1

# Start the server
CMD ["node", "server.js"] 