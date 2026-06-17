FROM node:20-slim

# Install build tools required for compiling native C++ addons
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies and compile sqlite3 from source
RUN npm ci --only=production --build-from-source=sqlite3

# Copy source code
COPY . .

# Expose health check port
EXPOSE 7860

# Start supervisor
CMD [ "npm", "start" ]
