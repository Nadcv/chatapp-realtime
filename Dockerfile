# Imagem para correr a app em qualquer serviço com Docker
# (Hugging Face Spaces, Koyeb, servidor próprio...).
FROM node:22-slim

# O Hugging Face Spaces corre o contentor com o utilizador de UID 1000
# (o "node" desta imagem); a app grava ficheiros .json na sua pasta,
# por isso tem de ser dona dela.
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && node -e "require('express'); require('socket.io'); require('mongoose')" \
 && npm cache clean --force
COPY --chown=node:node . .
RUN chown node:node /app
USER node

ENV NODE_ENV=production \
    PORT=7860
EXPOSE 7860
CMD ["node", "--max-old-space-size=8192", "server.js"]
