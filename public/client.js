// public/client.js
const socket = io(); // Assuming socket.io.js is loaded globally before this script
let unlocked = false;
const logEl = document.getElementById('log');

const TTS_DELAY_MS = 4000; // Delay in milliseconds (3.5 seconds)
const donationQueue = [];
let isPlaying = false;

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

      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                log('Audio context resumed successfully.');
                // Play silent sound after resuming context
                const buffer = audioContext.createBuffer(1, 1, 22050);
                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(audioContext.destination);
                source.start(0);
                log('Silent sound played to initialize audio context after resume.');
                processQueue(); // Attempt to process queue now that audio is unlocked
            }).catch(e => {
                console.error('Error resuming audio context:', e);
                log('Error resuming audio context: ' + e.message);
            });
        } else {
            // If not suspended, play silent sound directly
            const buffer = audioContext.createBuffer(1, 1, 22050);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
            log('Silent sound played to initialize audio context.');
            processQueue(); // Attempt to process queue now that audio is unlocked
        }
      } catch (e) {
        console.error('Error initializing audio context with silent sound:', e);
        log('Error initializing audio context: ' + e.message);
        // Still try to process queue as basic audio playback might work
        processQueue();
      }
    };
  } else {
    log('Enable Audio button not found.');
  }
});

function processQueue() {
  if (isPlaying || donationQueue.length === 0 || !unlocked) {
    return;
  }

  isPlaying = true;
  const data = donationQueue.shift();
  const { donor, amount, original, arabicText, ttsUrl } = data;

  log(`Processing donation from queue: ${donor} (${amount})`);

  setTimeout(() => {
    log('Attempting to play audio from URL: ' + ttsUrl + ` after ${TTS_DELAY_MS / 1000}s delay.`);

    const audio = new Audio(ttsUrl);

    const onAudioEnd = () => {
      audio.removeEventListener('ended', onAudioEnd);
      audio.removeEventListener('error', onAudioError);
      socket.emit('audioFinished'); // Signal server if needed
      log('Audio finished or failed for: ' + donor + '. Signaled server.');
      isPlaying = false;
      processQueue(); // Check for next item in queue
    };

    const onAudioError = (error) => {
      console.error('Audio playback error:', error);
      log('Audio playback error for ' + donor + ': ' + error.message);
      // onAudioEnd will also set isPlaying = false and processQueue()
      // No need to call them twice if error triggers 'ended' or if we ensure onAudioEnd handles cleanup robustly
      // However, directly calling onAudioEnd here ensures cleanup if 'ended' isn't guaranteed on all errors.
      onAudioEnd(); 
    };

    audio.addEventListener('ended', onAudioEnd);
    audio.addEventListener('error', onAudioError);

    audio.play()
      .then(() => {
        log('Audio playback successfully started for: ' + donor);
      })
      .catch(error => {
        console.error('Error initiating audio playback for ' + donor + ':', error);
        log('Error initiating audio playback for ' + donor + ': ' + error.message);
        onAudioEnd(); // Ensure queue processing continues even if play() fails
      });
  }, TTS_DELAY_MS);
}

socket.on('donation', function(data) {
  const { donor, amount, original, arabicText, ttsUrl } = data;

  log('Received donation: DONOR: ' + donor + ' (' + amount + ' DT):');
  log('   original: ' + original);
  log('   arabic  : ' + arabicText + '\n');

  if (!unlocked) {
    log('Audio not unlocked by user. Donation queued. Click "Enable Audio" button first.');
    // Queue it, processQueue will check for 'unlocked' status later
    donationQueue.push(data);
    // Don't call processQueue() here, let the unlock action trigger it if needed, or the next donation after unlock.
    return;
  }

  if (!ttsUrl) {
    log('Error: TTS URL is missing or invalid for donation from ' + donor + '. Donation ignored.');
    // Do not emit audioFinished here as nothing was played or attempted for this specific invalid data
    return;
  }
  
  log('Donation from ' + donor + ' added to queue.');
  donationQueue.push(data);
  processQueue(); // Attempt to process the queue
}); 