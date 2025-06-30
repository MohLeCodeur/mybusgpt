require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './public')));

// Configuration Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

// Chargement base de connaissances multi-formats
const allowedExtensions = ['.txt', '.md', '.pdf', '.docx'];
const docsPath = path.join(__dirname, 'docs');
let knowledgeBase = '';

async function extractTextFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.txt' || ext === '.md') {
        return fs.readFile(filePath, 'utf8');
    }
    if (ext === '.pdf') {
        const data = await fs.readFile(filePath);
        const pdfData = await pdfParse(data);
        return pdfData.text;
    }
    if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    }

    return '';
}

async function loadKnowledgeBase() {
    try {
        const files = await fs.readdir(docsPath);
        const allowedFiles = files.filter(file =>
            allowedExtensions.includes(path.extname(file).toLowerCase())
        );

        const fileContents = await Promise.all(
            allowedFiles.map(file => extractTextFromFile(path.join(docsPath, file)))
        );

        knowledgeBase = fileContents.join('\n\n');
        console.log(`✅ ${allowedFiles.length} fichier(s) chargé(s) dans la base de connaissances :`, allowedFiles);
    } catch (err) {
        console.error("❌ Erreur lors du chargement des fichiers :", err);
    }
}

loadKnowledgeBase();

// --- Route question ---
app.post('/api/ask', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ error: "Question manquante." });
    }

    const prompt = `
    Tu es un assistant expert spécialisé dans le projet MyBus.
    Réponds uniquement en te basant sur la documentation suivante.
    Si l'information n'est pas présente, commence ta réponse par : 
    "Cette information n'est pas dans la documentation du projet, mais voici une réponse basée sur mes connaissances générales :"

    --- DOCUMENTATION DU PROJET MYBUS ---
    ${knowledgeBase}
    --- FIN DE LA DOCUMENTATION ---

    Question : "${question}"

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

// --- Route génération quiz ---
app.post('/api/generate-quiz', async (req, res) => {
    const { topic } = req.body;
    const topicInstruction = topic 
        ? `Génère un quiz de 5 questions sur le sujet : "${topic}". Si ce n'est pas couvert, fais-le sur les thèmes principaux.`
        : "Génère un quiz varié de 5 questions sur l'ensemble de la documentation.";

    const prompt = `
    En te basant uniquement sur la documentation ci-dessous, génère un quiz.
    ${topicInstruction}
    Format JSON précis : tableau de 5 objets avec les clés :
    - "question": (string)
    - "options": (array of strings, 4 choix)
    - "answer": (string, bonne réponse)
    - "hint": (string, indice)

    Ne génère rien d'autre que le tableau JSON.

    --- DOCUMENTATION DU PROJET MYBUS ---
    ${knowledgeBase}
    --- FIN DE LA DOCUMENTATION ---

    Génère maintenant :
    `;

    console.log("📝 Génération du quiz, sujet :", topic || "Aléatoire");

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
        console.error("❌ Erreur génération quiz :", error);
        res.status(500).json({ error: "Erreur lors de la génération du quiz.", details: error.message });
    }
});

// --- Route correction quiz ---
app.post('/api/correct-quiz', async (req, res) => {
    const { quizData, userAnswers } = req.body;

    if (!quizData || !userAnswers) {
        return res.status(400).json({ error: "Données du quiz ou réponses manquantes." });
    }

    const prompt = `
    Tu es un correcteur de quiz expert.
    Voici le quiz et les réponses de l'utilisateur :

    Quiz : ${JSON.stringify(quizData, null, 2)}
    Réponses de l'utilisateur : ${JSON.stringify(userAnswers, null, 2)}

    Corrige et retourne ce JSON unique :
    {
      "score": nombre de bonnes réponses,
      "total": nombre total de questions,
      "results": [
        {
          "question": texte de la question,
          "userAnswer": réponse utilisateur (ou "Non répondu"),
          "correctAnswer": bonne réponse,
          "isCorrect": true/false,
          "justification": courte explication
        }
      ]
    }

    Rien d'autre que ce JSON.
    `;

    const generationConfig = {
        responseMimeType: "application/json",
    };

    try {
        const result = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig,
        });
        const responseText = (await result.response).text();
        const correctionJson = JSON.parse(responseText);
        res.json(correctionJson);
    } catch (error) {
        console.error("❌ Erreur correction quiz :", error);
        res.status(500).json({ error: "Erreur lors de la correction.", details: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
    console.log(`📂 Interface dispo sur http://localhost:${PORT}`);
});
