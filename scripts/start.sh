#!/bin/sh

# Démarrer le serveur backend
echo "🚀 Démarrage du serveur backend..."
node server/index.js &
BACKEND_PID=$!

# Attendre que le serveur backend soit prêt
echo "⏳ Attente du démarrage du serveur backend..."
sleep 3

# Vérifier que le serveur backend est toujours en cours d'exécution
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "❌ Le serveur backend a crashé au démarrage"
  exit 1
fi

echo "✅ Serveur backend démarré (PID: $BACKEND_PID)"

# Démarrer le serveur frontend
echo "🚀 Démarrage du serveur frontend..."
npm run dev -- --host

# Nettoyer si nécessaire
trap "kill $BACKEND_PID 2>/dev/null" EXIT

