module.exports = {
  apps: [{
    name: 'Tunisian-TTs-reader',
    script: 'index.js',
    watch: false,
    env: {
      "NODE_ENV": "development",
    },
    env_production: {
      "NODE_ENV": "production",
      // IMPORTANT: You need to paste your actual API keys here
      "API_KEY": "PASTE_YOUR_GOOGLE_GEMINI_API_KEY_HERE",
      "Eleven_API_KEY": "PASTE_YOUR_ELEVENLABS_API_KEY_HERE"
    }
  }]
}; 