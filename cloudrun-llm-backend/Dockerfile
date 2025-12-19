# Dockerfile for Cloud Run (optional - Cloud Run can build from source)
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "index.js"]

