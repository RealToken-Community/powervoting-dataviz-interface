FROM node:20-alpine

# Installer git (yarn est déjà inclus dans node:20-alpine)
# Configurer Git pour accepter les répertoires montés (nécessaire pour Docker volumes)
RUN apk add --no-cache git && \
    git config --global --add safe.directory /app && \
    git config --global --add safe.directory /app/balance-calculator

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5173 3001

# Installer les dépendances du serveur si nécessaire
RUN chmod +x scripts/*.sh 2>/dev/null || true

CMD ["sh", "scripts/start.sh"]
