import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import bodyParser from 'body-parser';
import { Server } from 'socket.io';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Readable } from 'stream';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express
const app = express();
app.use(bodyParser.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API key for Google Gemini (set in .env as API_KEY)
const apiKey = process.env.API_KEY;
if (!apiKey) {
  console.error('ERROR: Missing Google Gemini API_KEY in .env');
  process.exit(1);
}

// Initialize ElevenLabs client
const elevenLabsApiKey = process.env.Eleven_API_KEY;
if (!elevenLabsApiKey) {
  console.error('ERROR: Missing Eleven_API_KEY in .env for ElevenLabs');
  process.exit(1);
}
const elevenlabs = new ElevenLabsClient({ apiKey: elevenLabsApiKey });

// Initialize GoogleGenAI
const ai = new GoogleGenAI({ apiKey });

// Helper: Use Google Gemini 2.0 Flash API to convert mixed Arabizi → Arabic script
async function arabiziToArabic(text) {
  const prompt = `Convert the following Tunisian Arabizi text to fully vocalized (with Harakat/Tashkeel) Arabic script that best reflects common Tunisian pronunciation. If the input contains English words (like "bet", "game", "stream") or french words (like "contenu", "non", "merci"), preserve these English words in their original Latin script within the final Arabic output. If you find shortcuts for english words like('btw','IK','pls'), write the full words like('Bythe way','I know','please') Furthermore, if the input contains variations of the name 'gouba', such as 'gbaw', 'goobewi', 'guba', 'ghouba', or similar patterns, please normalize and write them as 'ڨُوبَا' (Gouba, using the letter ڨ for the 'g' sound). also if there is m3kky or similar patterns write it as makki Return ONLY the vocalized Arabic text with preserved English words and the normalized name, and no additional explanation, formatting, or original text. Input: "${text}"`;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 200 // Max output from Gemini itself
      }
    });
    let arabic = response.text?.trim();
    console.log('Converted Arabic (raw from Gemini):', arabic);

    // If Gemini still includes explanations, try to extract the core Arabic part
    // This is a heuristic and might need refinement based on Gemini's typical verbose output
    if (arabic && arabic.includes('**')) { // Assuming Gemini might use markdown for emphasis
        const boldParts = arabic.match(/\*\*(.*?)\*\*/g);
        if (boldParts && boldParts.length > 0) {
            // Take the first bold part, assuming it's the most relevant conversion
            arabic = boldParts[0].replace(/\*\*/g, '').trim(); 
        }
    }
    // Further cleanup: if there are multiple lines, take the first non-empty one
    if (arabic && arabic.includes('\n')) {
        arabic = arabic.split('\n').find(line => line.trim().length > 0) || arabic;
    }

    // Ensure the text is not too long for gTTS
    if (arabic && arabic.length > 190) {
      arabic = arabic.substring(0, 190);
      console.log('Truncated Arabic for TTS:', arabic);
    }

    console.log('Processed Arabic for TTS:', arabic);
    return arabic || text; // Fallback to original if conversion fails or is empty
  } catch (err) {
    console.error('Gemini conversion error:', err);
    return text; // fallback to original
  }
}

// Start server
const server = app.listen(3000, () => console.log('Bridge running at http://localhost:3000'));
const io = new Server(server);

// Webhook endpoint
app.post('/webhook', async (req, res) => {
    const { donor, amount, message } = req.body;
    if (!message) return res.sendStatus(204);
  
    // Fallbacks for missing donor or amount
    const donorName = donor || 'Anonymous';
    const donationAmount = amount || 0;
  
    // Convert to Arabic via Gemini
    const arabicText = await arabiziToArabic(message);
  
    // Create a local URL pointing to our /audio proxy endpoint
    const localTtsUrl = `/audio?text=${encodeURIComponent(arabicText)}`;
    console.log('Emitting local TTS URL to client:', localTtsUrl);

    // Emit donation data including converted text and LOCAL TTS URL
    io.emit('donation', {
      donor: donorName,
      amount: donationAmount,
      original: message,
      arabicText,
      ttsUrl: localTtsUrl // Send the local proxy URL
    });
  
    res.sendStatus(200);
  });

// Proxy TTS MP3 using ElevenLabs
app.get('/audio', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('Missing text query');
  try {
    const audioStream = await elevenlabs.textToSpeech.stream("OfGMGmhShO8iL9jCkXy8", {
      text: text,
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
    });

    res.set('Content-Type', 'audio/mpeg');

    // Convert Web API ReadableStream to Node.js Readable stream
    const nodeStream = Readable.fromWeb(audioStream);

    nodeStream.pipe(res);
    nodeStream.on('error', (err) => {
        console.error('Error piping stream:', err);
        if (!res.headersSent) {
            res.status(500).send('Server error during audio streaming');
        }
    });

  } catch (err) {
    console.error('ElevenLabs TTS error:', err);
    if (!res.headersSent) {
        res.status(500).send('Server error during TTS generation');
    }
  }
});

// Player page - NOW SERVES SIMPLER HTML
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Donation TTS Player</title>
  </head>
  <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
    <button id="enableBtn">Enable Audio</button>
    <pre id="log" style="white-space: pre-wrap; word-wrap: break-word; max-height: 300px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; width: 80%;"></pre>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/client.js"></script>  <!-- Link to our new static JS file -->
  </body>
</html>`);
});