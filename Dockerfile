FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose health check port (Hugging Face default)
EXPOSE 7860

# Start supervisor
CMD [ "npm", "start" ]
