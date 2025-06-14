import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import bodyParser from 'body-parser';
import { Server } from 'socket.io';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Readable } from 'stream';
import Groq from 'groq-sdk';
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

// API Keys
const groqApiKey = process.env.GROK_API_KEY; // Corrected to match your .env
if (!groqApiKey) {
  console.error('ERROR: Missing GROK_API_KEY in .env for Groq');
  process.exit(1);
}

// Initialize ElevenLabs client
const elevenLabsApiKey = process.env.Eleven_API_KEY;
if (!elevenLabsApiKey) {
  console.error('ERROR: Missing Eleven_API_KEY in .env for ElevenLabs');
  process.exit(1);
}
const elevenlabs = new ElevenLabsClient({ apiKey: elevenLabsApiKey });

// Initialize Groq Client
const groq = new Groq({ apiKey: groqApiKey });

// --- Cache for frequently translated texts ---
const translationCache = new Map();

// --- System Instruction for AI (Works for both Gemini and Llama) ---
const TUNISIAN_ARABIZI_SYSTEM_PROMPT = `You are an expert linguist specializing in Tunisian Arabizi. Your sole function is to convert Tunisian Arabizi text into fully vocalized Arabic script that reflects *native Tunisian* pronunciation and spelling, following these exact rules:

1. **Dialectal Pronunciation**
   - Render Tunisian sounds exactly: "ch" → ش, "kh" → خ, "gh" → غ, "dj"/"j" → ج, 7 is ح, 3 is ع, and 2 is ء.
   - Represent long vowels and elisions: "ana" → "أنا", "tawa" → "تَوَّا," "yemma" → "يِمَّا."
   - **Vowel Ambiguity:** Use context to resolve ambiguity. E.g., "hayet" (life) must be **حَيَاةْ** (with an alif), not "حَيَّةْ".
   - "g" (like "Gouba") is always ڨ. "q" is ق for Classical words, but ڨ if spoken as "g" in Tunisian.

2. **Tā' Marbūṭa (ة)**
   - In final position for dialectal words, do **not** use ة. Replace with "ه" if it sounds like /-a/, or omit if silent.
   - Keep ة for intended Classical/Modern Standard words (e.g., "madīnah").

3. **Foreign Words (French, English, etc.)**
   - **Do not** translate. Keep them in their original Latin script (e.g., "merci," "please," "content," "stream," "game").

4. **Abbreviations and Chat Shortcuts**
   - Expand English shortcuts to full words in Latin script: "btw" → "By the way," "pls" → "please."
   - Render dialectal Arabizi shortcuts phonetically in Arabic: "m3kky" → "معَاكِّي".

5. **Name Normalization**
   - Any variation of "gouba" ("gbaw," "goobewi," "guba," etc.) must become **ڨُوبَا**.
   - Any variation of "makki" ("m3kky," "m3ki," etc.) must become **مَاكِّي**.

6. **No Extra Text**
   - Return **only** the fully vocalized Arabic script. No explanations, no romanization, no extra punctuation.

7. **Examples (Follow these patterns exactly)**
   - \`n7eb nemchi na9ra ama manjjmtch\` → \`نْحِب نَمْشِي نَقْرَا أَمَّا مَا نْجَّمْتْش\`
   - \`sbah elkhir gooba kifech 7alek please\` → \`صْبَاحْ الْخِير ڨُوبَا كِيفِيش حَالِك please\`
   - \`m3kky ma t7ebch tl3eb bl3arbiya\` → \`مَاكِّي مَا تْحِبْش تْلْعَبْ بْلْعَرْبِيَّة\`
   - \`merci bros\` → \`merci bros\`
   - \`MAHREZ 94\` → \`مَحْرِزْ أَرْبَعَة و تِسْعُون\`
   - \`chna3mel b 84 diamonds\` → \`شْنَعْمِلْ ب أَرْبَعَة و ثَمَانُون diamonds\`

8. **Numeric Handling**
   - Digits inside an Arabizi word are consonants (7→ح, 3→ع, 2→ء), not numbers.
   - Convert stand-alone numbers (surrounded by whitespace/punctuation) to vocalized Arabic words.
   - If a number is followed by a unit (dt, tnd, $, diamonds), convert the number part to words and keep the unit in Latin script.
   - Examples: "94" → "أَرْبَعَة و تِسْعُون", but "3asba" → "عَصْبَة".

Below is the user input. Respond with **only** the final, fully vocalized Tunisian Arabic text.`;

// Helper: Use Groq Llama 3 for ultra-fast conversion
async function arabiziToArabic(text) {
  // --- Pre-processing Step ---
  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  let cleanedText = text.replace(emojiRegex, '').replace(/(\d)'/g, '$1').trim();

  if (!cleanedText) {
      console.log('Original text was only emojis or symbols. Skipping API call.');
      return ''; // Return empty string to prevent TTS
  }

  // --- Caching Layer ---
  if (translationCache.has(cleanedText)) {
    console.log('CACHE HIT: Returning cached translation for:', cleanedText);
    return translationCache.get(cleanedText);
  }
  console.log('CACHE MISS: Calling Groq API for:', cleanedText);
  // --- End Caching Layer ---

  try {
    const chatCompletion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: TUNISIAN_ARABIZI_SYSTEM_PROMPT,
            },
            {
                role: 'user',
                content: cleanedText,
            },
        ],
        model: 'llama3-8b-8192', // Use Meta's Llama 3 8B model
        temperature: 0.0,
        max_tokens: 200,
    });

    let arabic = chatCompletion.choices[0]?.message?.content?.trim() || '';
    console.log('Converted Arabic (raw from Groq):', arabic);

    // If the model still includes explanations, try to extract the core Arabic part
    if (arabic && arabic.includes('**')) { // Assuming model might use markdown
        const boldParts = arabic.match(/\*\*(.*?)\*\*/g);
        if (boldParts && boldParts.length > 0) {
            arabic = boldParts[0].replace(/\*\*/g, '').trim(); 
        }
    }
    if (arabic && arabic.includes('\n')) {
        arabic = arabic.split('\n').find(line => line.trim().length > 0) || arabic;
    }

    // Ensure the text is not too long for ElevenLabs
    if (arabic && arabic.length > 190) {
      arabic = arabic.substring(0, 190);
      console.log('Truncated Arabic for TTS:', arabic);
    }

    const result = arabic || cleanedText; // Fallback to cleaned original
    translationCache.set(cleanedText, result); // Save result to cache

    console.log('Processed Arabic for TTS:', result);
    return result; 
  } catch (err) {
    console.error('Groq conversion error:', err);
    return cleanedText; // fallback to cleaned original
  }
}

// Start server
const server = app.listen(3000, '0.0.0.0', () => {
    console.log('Bridge running at http://0.0.0.0:3000');
});
const io = new Server(server);

let ttsMinimumAmount = 0; // Default: No minimum. Any amount will be read.

io.on('connection', (socket) => {
    console.log('A client connected. Sending current threshold:', ttsMinimumAmount);
    // Send the current threshold to the newly connected client so its UI is in sync
    socket.emit('threshold_update', ttsMinimumAmount);

    socket.on('set_threshold', (newThreshold) => {
        const threshold = parseInt(newThreshold, 10);
        if (!isNaN(threshold) && threshold >= 0) {
            ttsMinimumAmount = threshold;
            console.log(`SERVER: TTS minimum amount set to > ${ttsMinimumAmount}`);
            // Broadcast the change to all clients so their UIs update
            io.emit('threshold_update', ttsMinimumAmount);
        } else {
            console.log(`SERVER: Received invalid threshold value from client: ${newThreshold}`);
        }
    });

    socket.on('disconnect', () => {
        console.log('A client disconnected.');
    });
});

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

    // SERVER-SIDE THRESHOLD CHECK
    // The buttons are labeled "> 10", so if threshold is 10, amounts of 10 or less are skipped.
    // We only apply this to 'DIAMONDS'. The check is case-insensitive and handles singular/plural.
    if (asset?.name?.toLowerCase().startsWith('diamond') && amount < ttsMinimumAmount) {
        console.log(`Webhook: Donation of ${amount} ${asset.name} is below threshold of ${ttsMinimumAmount}. Skipping TTS processing.`);
        return; // Exit without processing
    }

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
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.3,
        style: 0.0,
        use_speaker_boost: true
      }
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
      <button class="threshold-btn" data-threshold="2">&gt;= 2</button>
      <button class="threshold-btn" data-threshold="5">&gt;= 5</button>
      <button class="threshold-btn" data-threshold="10">&gt;= 10</button>
      <button class="threshold-btn" data-threshold="15">&gt;= 15</button>
      <button class="threshold-btn" data-threshold="20">&gt;= 20</button>
    </div>
    <pre id="log"></pre>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/client.js"></script>  <!-- Link to our new static JS file -->
  </body>
</html>`);
});