require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Servir les fichiers statiques du dossier 'public'
app.use(express.static(path.join(__dirname, './public')));

// Configuration de l'API Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Utilisation de 1.5-flash qui est excellent pour le JSON et le suivi d'instructions

// Charger la base de connaissances
let knowledgeBase = '';
fs.readFile(path.join(__dirname, 'knowledge_base.txt'), 'utf8')
  .then(data => {
    knowledgeBase = data;
    console.log("✅ Base de connaissances chargée avec succès.");
  })
  .catch(err => {
    console.error("❌ Erreur de chargement de la base de connaissances :", err);
  });

// --- Route pour poser des questions (inchangée) ---
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "Question manquante." });
  }

  const prompt = `
    Tu es un assistant expert spécialisé dans le projet MyBus.
    Ta mission principale est de répondre aux questions en te basant sur la documentation du projet fournie ci-dessous.
    Si la réponse se trouve dans la documentation, réponds directement.
    Si la réponse ne se trouve PAS dans la documentation, commence ta réponse par la phrase "Cette information n'est pas dans la documentation du projet, mais voici une réponse basée sur mes connaissances générales :", puis réponds à la question.

    --- DOCUMENTATION DU PROJET MYBUS ---
    ${knowledgeBase}
    --- FIN DE LA DOCUMENTATION ---

    Question de l'utilisateur : "${question}"

    Ta réponse :
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    res.json({ answer: response.text() });
  } catch (error) {
    console.error("❌ Erreur API Gemini :", error);
    res.status(500).json({ error: "Erreur lors de la communication avec l'API Gemini." });
  }
});

// --- Route pour générer un quiz (Mise à jour pour accepter un sujet) ---
app.post('/api/generate-quiz', async (req, res) => {
    const { topic } = req.body; // Récupère le sujet optionnel

    // Instruction dynamique basée sur la présence d'un sujet
    const topicInstruction = topic 
        ? `Génère un quiz de 5 questions spécifiquement sur le sujet suivant : "${topic}". Si le sujet est trop vague ou non couvert par la documentation, génère un quiz sur les thèmes principaux.`
        : "Génère un quiz varié de 5 questions sur l'ensemble de la documentation.";

    const prompt = `
        En te basant exclusivement sur la documentation du projet MyBus fournie ci-dessous, génère un quiz.
        ${topicInstruction}
        Le quiz doit être au format JSON valide et suivre précisément cette structure : un tableau de 5 objets.
        Chaque objet doit contenir :
        - "question": (string) La question.
        - "options": (array of strings) Un tableau de 4 options de réponse possibles.
        - "answer": (string) Le texte exact de la bonne réponse parmi les options.
        - "hint": (string) Un indice pour aider l'utilisateur.

        Ne génère RIEN d'autre que le tableau JSON lui-même.

        --- DOCUMENTATION DU PROJET MYBUS ---
        ${knowledgeBase}
        --- FIN DE LA DOCUMENTATION ---

        Génère maintenant le quiz JSON.
    `;

    console.log("📝 Prompt envoyé pour la génération du quiz (sujet : " + (topic || "Aléatoire") + ").");

    const generationConfig = {
        responseMimeType: "application/json",
    };

    try {
        const result = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
        });
        const responseText = (await result.response).text();
        const quizJson = JSON.parse(responseText);
        res.json(quizJson);
    } catch (error) {
        console.error("❌ Erreur API Gemini (Quiz) :", error);
        res.status(500).json({ error: "Erreur lors de la génération du quiz.", details: error.message });
    }
});

// === NOUVELLE ROUTE POUR LA CORRECTION DU QUIZ ===
app.post('/api/correct-quiz', async (req, res) => {
    const { quizData, userAnswers } = req.body;

    if (!quizData || !userAnswers) {
        return res.status(400).json({ error: "Données du quiz ou réponses de l'utilisateur manquantes." });
    }

    const prompt = `
        Tu es un correcteur de quiz expert.
        Ta mission est de corriger les réponses d'un utilisateur et de fournir un résultat détaillé au format JSON.

        Voici le quiz original avec les bonnes réponses :
        ${JSON.stringify(quizData, null, 2)}

        Voici les réponses fournies par l'utilisateur :
        ${JSON.stringify(userAnswers, null, 2)}

        Analyse chaque réponse et génère un objet JSON unique avec la structure suivante :
        {
          "score": (number) Le nombre de bonnes réponses.
          "total": (number) Le nombre total de questions.
          "results": [
            {
              "question": (string) Le texte de la question.
              "userAnswer": (string) La réponse de l'utilisateur (ou "Non répondu").
              "correctAnswer": (string) La bonne réponse.
              "isCorrect": (boolean) True si la réponse de l'utilisateur est correcte, sinon false.
              "justification": (string) Une brève explication sur pourquoi la bonne réponse est correcte, basée sur la documentation.
            }
          ]
        }
        Ne renvoie rien d'autre que cet objet JSON.
    `;

    const generationConfig = {
        responseMimeType: "application/json",
    };

    console.log("📝 Envoi des réponses pour correction...");

    try {
        const result = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
        });
        const responseText = (await result.response).text();
        const correctionJson = JSON.parse(responseText);
        console.log("✅ Correction reçue de l'API.");
        res.json(correctionJson);
    } catch (error) {
        console.error("❌ Erreur API Gemini (Correction Quiz) :", error);
        res.status(500).json({ error: "Erreur lors de la correction du quiz.", details: error.message });
    }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Serveur backend démarré sur http://localhost:${PORT}`);
    console.log(`Interface utilisateur disponible sur http://localhost:${PORT}`);
});