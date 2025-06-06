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

// Add route for standalone Ba9chich listener
app.get('/ba9chich', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/ba9chich_standalone.html'));
});

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
  const prompt = `Convert the following Tunisian Arabizi text into fully vocalized Arabic script that reflects *native Tunisian* pronunciation and spelling, with these exact rules:

1. **Dialectal Pronunciation**  
   - Render Tunisian sounds exactly: e.g., "ch" → ش, "kh" → خ, "gh" → غ, "dj"/"j" → ج (as pronounced in Tunisia), 7 is  ح, also 9 is ق also 3 is ع also 2 is ء.
   - Represent long vowels and common elisions: for example, write "أنا" for "ana," "tawa" → "تَوَّا," "yemma" → "يِمَّا."  
   - **Vowel Ambiguity:** Pay very close attention to context to resolve ambiguity. A common mistake is misinterpreting vowels. For instance, the word "hayet" (life) should be written as **حَيَاةْ** (with an alif), not as "حَيَّةْ". Use the surrounding words to choose the correct meaning and spelling.
   - For "g" (as in "Gouba"), always use ڨ. For "q" when it's the standard Qāf (e.g., in words of Classical origin), use ق, but if it's spoken "g" in Tunisian, use ڨ.

2. **Tā' Marbūṭa (ة)**  
   - In final position, **do not** include ة for dialectal words that are not pronounced. Instead, either replace with "ه" if it sounds like /-a/ (e.g., "bhitha" → "بْحِيثَا" becomes "بْحِيثَا" with no ة), or drop it completely if truly silent.  
   - If the writer clearly intends a Classical/Modern Standard word ending in ة (e.g., "madīnah"), keep ة and vocalize it as normal.

3. **Foreign Words (French, English, etc.)**  
   - Do **not** translate foreign words into Arabic. Keep them in their original Latin script exactly as they appear.  
   - Do **not** convert "merci," "please," "content," etc., into Arabic equivalents. Preserve "merci," "please," "contenu," "stream," "game," etc., as-is.

4. **Abbreviations and Chat Shortcuts**  
   - Expand common shortcuts into full English words, but keep them in Latin script. For instance, "btw" → "By the way," "IK" → "I know," "pls" → "please."  
   - If an abbreviation in Arabizi is dialectal (e.g., "m3kky" → "ma3akki"), render it phonetically in Arabic ("معَاكِّي").

5. **Name Normalization**  
   - Any variation of the name "gouba" ("gbaw," "goobewi," "guba," "ghouba," etc.) must become **ڨُوبَا**.  
   - Any variation of "makki" ("m3kky," "m3ki," etc.) must become **مَاكِّي**.

6. **No Extra Text**  
   - Return **only** the vocalized Arabic script that a Tunisian speaker would naturally read. Do **not** include any explanations, romanization, punctuation besides standard Arabic diacritics (fatḥa, kasra, ḍamma, shadda, sukun), or markup.  
   - Do **not** output the original input or any metadata—only the final Arabic line(s).

7. **Examples for Clarity (you must follow these patterns exactly)**  
   - Input: \`n7eb nemchi na9ra ama manjjmtch zaaaaaab\`  
     Output: \`نْحِب نَمْشِي نَقْرَا أَمَّا مَا نْجَّمْتْش زَاب\`  
   - Input: \`sbah elkhir gooba kifech 7alek please\`  
     Output: \`صْبَاحْ الْخِير ڨُوبَا كِيفِيش حَالِك please\`  
   - Input: \`m3kky ma t7ebch tl3eb bl3arbiya\`  
     Output: \`مَاكِّي مَا تْحِبْش تْلْعَبْ بْلْعَرْبِيَّة\`  
   - Input: \`merci bros\`  
     Output: \`merci bros\`

Below is the input. Return **only** the fully vocalized Tunisian Arabic text following all rules above. Do **not** add commentaryand pay attention please for all the letters and numbers and the rules.

Input: "${text}"`;
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
const server = app.listen(3000, '0.0.0.0', () => {
    console.log('Bridge running at http://0.0.0.0:3000');
});
const io = new Server(server);

// Webhook endpoint - UPDATED FOR OFFICIAL BA9CHICH PAYLOAD
app.post('/webhook', async (req, res) => {
    console.log("!!!!!!!!!! /webhook ENDPOINT HIT !!!!!!!!!!");
    console.log("Official Ba9chich Webhook Received!");

    // IMPORTANT: Implement signature verification if Ba9chich provides a secret key and signature header
    // const receivedSignature = req.headers['x-ba9chich-signature']; // Example header
    // const BA9CHICH_WEBHOOK_SECRET = process.env.BA9CHICH_WEBHOOK_SECRET;
    // if (!BA9CHICH_WEBHOOK_SECRET) {
    //     console.warn("BA9CHICH_WEBHOOK_SECRET is not set. Skipping signature verification. THIS IS INSECURE for production.");
    // } else if (!isValidBa9chichSignature(req.rawBody || JSON.stringify(req.body), receivedSignature, BA9CHICH_WEBHOOK_SECRET)) {
    //     console.error("Invalid Ba9chich webhook signature.");
    //     return res.status(400).send("Invalid signature.");
    // }
    // Note: For req.rawBody, you might need to use a different middleware than bodyParser.json(),
    // or bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf.toString() } })

    const paymentData = req.body;
    console.log("Payment Data:", JSON.stringify(paymentData, null, 2));

    const { paymentID, message, donor, amount, asset } = paymentData;

    // Validate required fields based on Ba9chich schema
    if (typeof paymentID === 'undefined' || typeof amount === 'undefined' || typeof asset === 'undefined') {
        console.error('Webhook error: Missing required fields (paymentID, amount, or asset).', paymentData);
        return res.status(400).send('Missing required fields.');
    }

    // Respond immediately to Ba9chich to prevent timeouts and retries
    res.status(200).send('Webhook received successfully.'); 

    // --- Process the data asynchronously after we've already responded ---

    if (message && message.trim().length === 0) {
        // If message is present but empty or just whitespace, treat as no message for TTS
        console.log('Webhook: Received empty message, will not process for TTS.');
        return; // Exit after sending 200 OK
    }
    if (!message) {
        console.log('Webhook: No message provided.');
        io.emit('donation_nomessage', { // Emit a different event for no-message donations if needed
            donor: donor?.username || 'Anonymous',
            amount: amount,
            asset: asset?.name
        });
        return; // Exit after sending 200 OK
    }
  
    const donorName = donor?.username || 'Anonymous';
    const donationAmount = `${amount} ${asset?.name || ''}`;
  
    const arabicText = await arabiziToArabic(message);
  
    const localTtsUrl = `/audio?text=${encodeURIComponent(arabicText)}`;
    console.log('Emitting local TTS URL to client:', localTtsUrl);

    io.emit('donation', {
      paymentID,
      donor: donorName,
      displayAmount: donationAmount,
      amountValue: amount,
      assetType: asset?.name,
      original: message,
      arabicText,
      ttsUrl: localTtsUrl 
    });
  
    // The res.status(200) was moved to the top
  });

// Placeholder for signature verification function (you'd need to implement this based on Ba9chich's method)
// function isValidBa9chichSignature(rawBody, signature, secret) {
//   const crypto = require('crypto');
//   // Example: const calculatedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
//   // return crypto.timingSafeEqual(Buffer.from(calculatedSignature), Buffer.from(signature));
//   return true; // Insecure placeholder
// }

// Proxy TTS MP3 using ElevenLabs
app.get('/audio', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('Missing text query');
  try {
    const audioStream = await elevenlabs.textToSpeech.stream("OfGMGmhShO8iL9jCkXy8", {
      text: text,
      modelId: "eleven_multilingual_v2",
      
      //modelId: "eleven_flash_v2_5",
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
    <style>
      body { font-family: sans-serif; display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh; margin: 0; }
      #enableBtn, .threshold-btn { padding: 8px 15px; border: 1px solid #ccc; background-color: #f0f0f0; cursor: pointer; margin: 5px; border-radius: 5px; }
      .threshold-btn.active { background-color: #007bff; color: white; border-color: #007bff; font-weight: bold; }
      #tts-controls { display: none; text-align: center; margin-bottom: 10px; padding: 10px; border: 1px solid #eee; border-radius: 8px; }
      #log { white-space: pre-wrap; word-wrap: break-word; max-height: 300px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; width: 80%; background-color: #f9f9f9; }
    </style>
  </head>
  <body>
    <button id="enableBtn">Enable Audio</button>
    <div id="tts-controls">
      <div><strong>TTS Minimum (Diamonds)</strong></div>
      <button class="threshold-btn active" data-threshold="0">Any</button>
      <button class="threshold-btn" data-threshold="2">&gt; 2</button>
      <button class="threshold-btn" data-threshold="5">&gt; 5</button>
      <button class="threshold-btn" data-threshold="10">&gt; 10</button>
      <button class="threshold-btn" data-threshold="15">&gt; 15</button>
      <button class="threshold-btn" data-threshold="20">&gt; 20</button>
    </div>
    <pre id="log"></pre>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/client.js"></script>  <!-- Link to our new static JS file -->
  </body>
</html>`);
});