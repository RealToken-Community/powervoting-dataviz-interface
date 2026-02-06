#!/bin/sh

# Démarrer le serveur backend en arrière-plan
node server/index.js &
BACKEND_PID=$!

# Attendre que le serveur backend soit prêt
sleep 2

# Démarrer le serveur frontend
npm run dev -- --host

# Nettoyer si nécessaire
trap "kill $BACKEND_PID" EXIT

