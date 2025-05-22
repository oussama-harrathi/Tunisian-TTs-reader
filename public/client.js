// public/client.js
const socket = io(); // Assuming socket.io.js is loaded globally before this script
let unlocked = false;
const logEl = document.getElementById('log');

function log(msg) {
  if (logEl) {
    logEl.textContent += msg + '\n';
  }
  console.log(msg); // Log to browser console
}

document.addEventListener('DOMContentLoaded', () => {
  const enableBtn = document.getElementById('enableBtn');
  if (enableBtn) {
    enableBtn.onclick = function() {
      unlocked = true;
      enableBtn.style.display = 'none';
      log('Audio unlocked by user click.');

      // Attempt to play a silent sound to truly unlock audio context
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') { // Politely resume if suspended
            audioContext.resume();
        }
        const buffer = audioContext.createBuffer(1, 1, 22050);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(0);
        log('Silent sound played to initialize audio context.');
      } catch (e) {
        console.error('Error initializing audio context with silent sound:', e);
        log('Error initializing audio context: ' + e.message);
      }
    };
  } else {
    log('Enable Audio button not found.');
  }
});

socket.on('donation', function(data) {
  const { donor, amount, original, arabicText, ttsUrl } = data;

  log('Received donation: DONOR: ' + donor + ' (' + amount + ' DT):');
  log('   original: ' + original);
  log('   arabic  : ' + arabicText + '\n');

  if (!unlocked) {
    log('Audio not unlocked by user. Click "Enable Audio" button first.');
    socket.emit('audioFinished');
    return;
  }

  if (!ttsUrl) {
    log('Error: TTS URL is missing or invalid.');
    socket.emit('audioFinished');
    return;
  }
  
  log('Attempting to play audio from URL: ' + ttsUrl);

  const audio = new Audio(ttsUrl);
  
  const onAudioEnd = () => {
    audio.removeEventListener('ended', onAudioEnd);
    audio.removeEventListener('error', onAudioError);
    socket.emit('audioFinished');
    log('Audio finished or failed, signaled server.');
  };

  const onAudioError = (error) => {
    console.error('Audio playback error:', error);
    log('Audio playback error: ' + error.message);
    onAudioEnd();
  };

  audio.addEventListener('ended', onAudioEnd);
  audio.addEventListener('error', onAudioError);
  
  audio.play()
    .then(() => {
      log('Audio playback successfully started.');
    })
    .catch(error => {
      console.error('Error initiating audio playback:', error);
      log('Error initiating audio playback: ' + error.message);
      onAudioEnd();
    });
}); 